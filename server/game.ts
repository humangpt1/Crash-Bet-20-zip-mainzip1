import { WebSocket, WebSocketServer } from "ws";
import { Server } from "http";
import { storage } from "./storage";
import { wsEvents } from "@shared/routes";
import crypto from "crypto";

interface Client extends WebSocket {
  userId?: number;
  username?: string;
  isAlive: boolean;
}

interface NextBet {
  amount: number;
  autoCashout?: number | null;
}

/**
 * House edge configuration for the crash curve.
 * Tuned so the house wins decisively over time while keeping rounds fun:
 *   - HOUSE_EDGE 0.18 = 18% theoretical edge (player EV ≈ 0.82 per unit wagered).
 *   - INSTANT_BUST_CHANCE 0.10 = ~1 in 10 rounds bust at 1.00x.
 * The math still uses the standard provably-fair formula —
 *   crash = (1 - residualEdge) / (1 - v)
 * — so distribution shape is preserved, just shifted toward the house.
 */
const HOUSE_EDGE = 0.18;
const INSTANT_BUST_CHANCE = 0.10;

export class GameEngine {
  private wss: WebSocketServer;
  private status: "betting" | "active" | "crashed" = "crashed";
  private currentRoundId: number | null = null;
  private crashPoint = 1.0;
  private multiplier = 1.0;
  private startTime = 0;
  private growthRate = 0.06;
  private gameLoop: NodeJS.Timeout | null = null;
  private stateBroadcastInterval: NodeJS.Timeout | null = null;
  private bettingTimeout: NodeJS.Timeout | null = null;
  private serverSeed = "";
  private serverSeedHash = "";
  private clientSeed = "00000000000000000000000000000000";
  private nonce = 0;
  private nextBets: Record<number, Record<number, NextBet>> = {};

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.setupWebSocket();
    this.startNewRound();
  }

  // ────────────────────────────────────────────────
  // WebSocket
  // ────────────────────────────────────────────────
  private setupWebSocket() {
    this.wss.on("connection", (ws: Client) => {
      ws.isAlive = true;
      ws.on("pong", () => (ws.isAlive = true));

      ws.on("message", (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          if (data.type === "auth" && typeof data.userId === "number") {
            ws.userId = data.userId;
            ws.username = data.username;
          }
        } catch (err) {
          console.warn("Invalid WS message:", err);
        }
      });

      ws.send(
        JSON.stringify({
          type: wsEvents.SERVER_STATE_UPDATE,
          payload: this.getStatus(),
        }),
      );
    });

    const heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const client = ws as Client;
        if (!client.isAlive) {
          client.terminate();
          return;
        }
        client.isAlive = false;
        client.ping();
      });
    }, 30000);

    this.wss.on("close", () => clearInterval(heartbeatInterval));
  }

  // ────────────────────────────────────────────────
  // Broadcast Helpers
  // ────────────────────────────────────────────────
  public broadcast(type: string, payload: any) {
    const message = JSON.stringify({ type, payload });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  public sendToUser(userId: number, type: string, payload: any) {
    const message = JSON.stringify({ type, payload });
    this.wss.clients.forEach((client) => {
      const c = client as Client;
      if (c.readyState === WebSocket.OPEN && c.userId === userId) {
        c.send(message);
      }
    });
  }

  // ────────────────────────────────────────────────
  // Provably-fair crash point with sustainable house edge.
  //
  // Formula (industry standard, verifiable):
  //   1. Draw u ∈ [0,1) from HMAC-SHA256(serverSeed, clientSeed:nonce).
  //   2. With probability HOUSE_EDGE → bust at 1.00x.
  //   3. Otherwise crash = (1 - HOUSE_EDGE) / (1 - u), clamped to [1.00, 1000].
  //
  // This yields a player EV of (1 - HOUSE_EDGE) per unit wagered when chasing
  // any cashout multiplier — the same edge across all strategies.
  // ────────────────────────────────────────────────
  private generateCrashPoint(): number {
    this.serverSeed = crypto.randomBytes(32).toString("hex");
    this.serverSeedHash = crypto
      .createHash("sha256")
      .update(this.serverSeed)
      .digest("hex");
    this.nonce++;

    const hmac = crypto.createHmac("sha256", this.serverSeed);
    hmac.update(`${this.clientSeed}:${this.nonce}`);
    const hash = hmac.digest("hex");

    // 52-bit float in [0,1)
    const h = parseInt(hash.slice(0, 13), 16);
    const u = h / Math.pow(2, 52);

    // Instant-bust band (the house-edge slice)
    if (u < INSTANT_BUST_CHANCE) {
      return 1.0;
    }

    // Renormalise the remaining range so the rest of the distribution covers
    // [INSTANT_BUST_CHANCE, 1) with the standard 1/(1-x) curve.
    const v = (u - INSTANT_BUST_CHANCE) / (1 - INSTANT_BUST_CHANCE);

    // Apply the residual edge so player EV per round = 1 - HOUSE_EDGE.
    const residualEdge =
      (HOUSE_EDGE - INSTANT_BUST_CHANCE) / (1 - INSTANT_BUST_CHANCE);
    const fairFactor = Math.max(0, 1 - residualEdge);

    let crashPoint = fairFactor / (1 - v);

    // Hard cap 1000x for safety
    if (!isFinite(crashPoint) || crashPoint > 1000) crashPoint = 1000;
    if (crashPoint < 1.0) crashPoint = 1.0;

    return Math.floor(crashPoint * 100) / 100;
  }

  // ────────────────────────────────────────────────
  // Round Lifecycle
  // ────────────────────────────────────────────────
  private async startNewRound(): Promise<void> {
    try {
      this.clearTimers();
      this.status = "betting";
      this.multiplier = 1.0;
      this.crashPoint = this.generateCrashPoint();

      const round = await storage.createRound(
        this.crashPoint,
        this.serverSeed,
        this.clientSeed,
        this.nonce,
        this.serverSeedHash,
      );

      this.currentRoundId = round.id;

      this.broadcast(wsEvents.SERVER_ROUND_START, {
        roundId: this.currentRoundId,
        serverSeedHash: this.serverSeedHash,
        ...this.getStatus(),
      });

      this.bettingTimeout = setTimeout(() => this.startGame(), 5000);
    } catch (error) {
      console.error("Failed to start new round:", error);
      setTimeout(() => this.startNewRound(), 2000);
    }
  }

  private async startGame(): Promise<void> {
    if (this.status !== "betting") return;

    this.status = "active";
    this.startTime = Date.now();

    if (this.currentRoundId) {
      await storage.updateRoundStatus(this.currentRoundId, "active");
    }

    this.broadcast(wsEvents.SERVER_STATE_UPDATE, this.getStatus());

    this.gameLoop = setInterval(() => this.tick(), 50);
    this.stateBroadcastInterval = setInterval(() => this.broadcastState(), 100);

    for (const userIdStr in this.nextBets) {
      const userId = Number(userIdStr);
      for (const slotStr in this.nextBets[userId]) {
        const slot = Number(slotStr);
        const queued = this.nextBets[userId][slot];
        this.placeBet(
          userId,
          slot,
          queued.amount,
          queued.autoCashout,
          false,
        ).catch((err) => console.warn("Auto-place queued bet failed:", err));
      }
    }

    this.nextBets = {};
  }

  private clearTimers(): void {
    [this.gameLoop, this.stateBroadcastInterval, this.bettingTimeout].forEach(
      (timer) => timer && clearInterval(timer),
    );
    this.gameLoop = null;
    this.stateBroadcastInterval = null;
    this.bettingTimeout = null;
  }

  private async tick(): Promise<void> {
    if (this.status !== "active") return;

    const elapsed = Date.now() - this.startTime;
    this.multiplier = Math.pow(Math.E, this.growthRate * (elapsed / 1000));

    if (this.multiplier >= this.crashPoint) {
      this.multiplier = this.crashPoint;
      await this.crash();
      return;
    }

    if (!this.currentRoundId) return;

    const activeBets = await storage.getActiveBets(this.currentRoundId);

    await Promise.all(
      activeBets.map(async (bet) => {
        if (
          bet.status === "active" &&
          bet.autoCashout &&
          this.multiplier >= bet.autoCashout &&
          this.multiplier < this.crashPoint
        ) {
          await this.handleCashout(
            bet.userId,
            bet.autoCashout,
            bet.playerIndex,
          ).catch((err) => console.warn("Auto-cashout failed:", err));
        }
      }),
    );
  }

  private async crash(): Promise<void> {
    this.status = "crashed";
    this.clearTimers();

    if (this.currentRoundId) {
      await storage.updateRoundStatus(
        this.currentRoundId,
        "crashed",
        new Date(),
      );

      const activeBets = await storage.getActiveBets(this.currentRoundId);

      await Promise.all(
        activeBets
          .filter((b) => b.status === "active")
          .map((b) => storage.updateBetStatus(b.id, "lost")),
      );
    }

    this.broadcast(wsEvents.SERVER_ROUND_CRASH, {
      crashPoint: this.crashPoint,
      multiplier: this.multiplier,
      serverSeed: this.serverSeed,
      timestamp: Date.now(),
    });

    this.broadcastState();
    setTimeout(() => this.startNewRound(), 3000);
  }

  // ────────────────────────────────────────────────
  // Place Bet
  // ────────────────────────────────────────────────
  public async placeBet(
    userId: number,
    playerIndex: number,
    amount: number,
    autoCashout?: number | null,
    saveNextBet: boolean = false,
  ) {
    if (!this.currentRoundId) {
      throw new Error("No active round available");
    }
    if (playerIndex < 0 || playerIndex > 1) {
      throw new Error("Slot must be 1 or 2");
    }

    if (!saveNextBet && this.status !== "betting") {
      throw new Error(
        "Cannot place immediate bet now — please queue for the next round",
      );
    }

    const userSlots = await storage.getUserSlots(userId);
    const slot = userSlots[playerIndex];

    if (!slot) {
      throw new Error(`Slot ${playerIndex + 1} not found`);
    }

    const slotBalance = slot.balance ?? 0;
    if (slotBalance < amount) {
      throw new Error("Insufficient balance");
    }

    const newBalance = slotBalance - amount;
    await storage.updateSlotBalance(userId, playerIndex, newBalance);

    // Track wagering for withdrawal eligibility
    await storage.incrementUserWagered(userId, amount);

    const bet = await storage.placeBet(
      this.currentRoundId,
      userId,
      playerIndex,
      amount,
      autoCashout,
    );

    this.sendToUser(userId, wsEvents.SERVER_BALANCE_UPDATE, {
      slots: await storage.getUserSlots(userId),
    });

    this.broadcast(wsEvents.SERVER_BET_PLACED, {
      bet: {
        id: bet.id,
        roundId: this.currentRoundId,
        userId: bet.userId,
        playerIndex,
        amount: bet.amount,
        autoCashout: bet.autoCashout ?? null,
        status: bet.status,
        createdAt: bet.createdAt ?? Date.now(),
      },
      user: { id: userId },
    });

    if (saveNextBet) {
      if (!this.nextBets[userId]) this.nextBets[userId] = {};
      this.nextBets[userId][playerIndex] = { amount, autoCashout };
    }

    return bet;
  }

  // ────────────────────────────────────────────────
  // Cashout Bet
  // ────────────────────────────────────────────────
  public async handleCashout(
    userId: number,
    cashoutValue?: number,
    playerIndex: number = 0,
  ): Promise<number> {
    if (this.status !== "active") {
      throw new Error("Round is not active");
    }
    if (!this.currentRoundId) {
      throw new Error("No active round");
    }

    const activeBets = await storage.getActiveBets(this.currentRoundId);
    const bet = activeBets.find(
      (b) =>
        b.userId === userId &&
        b.status === "active" &&
        b.playerIndex === playerIndex,
    );

    if (!bet) {
      throw new Error("No active bet found for this slot");
    }

    const cashoutMultiplier = cashoutValue ?? this.multiplier;

    if (cashoutMultiplier > this.crashPoint + 0.001) {
      throw new Error("Cashout value exceeds crash point");
    }

    const winAmount = Math.floor(bet.amount * cashoutMultiplier);

    await storage.updateBetStatus(bet.id, "won", cashoutMultiplier, winAmount);

    const slot = await storage.getSlot(userId, playerIndex);
    if (slot) {
      await storage.updateSlotBalance(
        userId,
        playerIndex,
        slot.balance + winAmount,
      );

      this.sendToUser(userId, wsEvents.SERVER_BALANCE_UPDATE, {
        slots: await storage.getUserSlots(userId),
      });
    }

    this.broadcast(wsEvents.SERVER_BET_CASHED_OUT, {
      bet: {
        id: bet.id,
        roundId: this.currentRoundId,
        userId: bet.userId,
        playerIndex: bet.playerIndex,
        amount: bet.amount,
        autoCashout: bet.autoCashout ?? null,
        status: "won",
        cashoutMultiplier,
        winAmount,
        createdAt: bet.createdAt ?? Date.now(),
      },
      user: { id: userId },
      timestamp: Date.now(),
    });

    return winAmount;
  }

  // ────────────────────────────────────────────────
  // State Helpers
  // ────────────────────────────────────────────────
  private broadcastState(): void {
    this.broadcast(wsEvents.SERVER_STATE_UPDATE, this.getStatus());
  }

  public getStatus() {
    return {
      status: this.status,
      multiplier: this.multiplier,
      roundId: this.currentRoundId,
      elapsed: this.status === "active" ? Date.now() - this.startTime : 0,
      serverSeedHash: this.serverSeedHash,
    };
  }
}
