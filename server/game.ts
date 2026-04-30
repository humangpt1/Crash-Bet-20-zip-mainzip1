import { WebSocket, WebSocketServer } from "ws";
import { Server } from "http";
import { storage } from "./storage";
import { wsEvents } from "@shared/routes";
import { maskPhone } from "@shared/schema";
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

interface FakeUser {
  id: number; // negative, never collides with real user ids
  masked: string; // e.g. "0712****78"
}

interface FakeBet {
  betId: number; // negative, never collides with real bet ids
  userId: number;
  masked: string;
  playerIndex: number;
  amount: number; // cents
  autoCashout: number | null;
  status: "active" | "won";
  cashedOut: boolean;
  createdAt: number;
}

/**
 * Once at least this many DISTINCT real players have placed a bet in the
 * current round, we stop broadcasting any further fake bets — the room is
 * lively enough on its own.
 */
const REAL_BETTOR_THRESHOLD = 20;

/**
 * House edge configuration for the crash curve.
 * Tuned heavily in the house's favour:
 *   - HOUSE_EDGE 0.50  → player long-run EV ≈ 50% of stake.
 *   - INSTANT_BUST_CHANCE 0.35 → ~1 in 3 rounds bust at 1.00x.
 * The provably-fair HMAC formula stays intact —
 *   crash = (1 - residualEdge) / (1 - v)
 * — only the constants are biased.
 */
const HOUSE_EDGE = 0.5;
const INSTANT_BUST_CHANCE = 0.35;

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

  // ── Fake-player simulator state ─────────────────────────────
  private fakePool: FakeUser[] = [];
  private fakeBetSeq = 0;
  private currentRoundFakeBets = new Map<number, FakeBet>();
  private fakeTimers: NodeJS.Timeout[] = [];
  private realBettorsThisRound = new Set<number>();
  private userMaskCache = new Map<number, string>();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.buildFakePool();
    this.setupWebSocket();
    this.startNewRound();
  }

  // ────────────────────────────────────────────────
  // Fake-player simulator
  // ────────────────────────────────────────────────
  private buildFakePool(size = 80) {
    const prefixes = ["070", "071", "072", "074", "079", "0110", "0111"];
    this.fakePool = [];
    for (let i = 0; i < size; i++) {
      const p = prefixes[Math.floor(Math.random() * prefixes.length)];
      let n = "";
      for (let k = 0; k < 10 - p.length; k++) n += Math.floor(Math.random() * 10);
      const phone = p + n;
      this.fakePool.push({
        id: -(1000 + i),
        masked: maskPhone(phone),
      });
    }
  }

  private cancelFakeTimers() {
    this.fakeTimers.forEach((t) => clearTimeout(t));
    this.fakeTimers = [];
  }

  /**
   * During the 5-second betting window, drip 22-31 fake bets onto the wire so
   * the live-bets feed always feels busy. Each scheduled bet checks the real
   * bettor count just before broadcasting and self-cancels if real activity
   * has already passed the threshold.
   */
  private seedFakeBets(roundId: number) {
    this.cancelFakeTimers();
    this.currentRoundFakeBets.clear();

    const target = 22 + Math.floor(Math.random() * 10); // 22..31
    const pool = [...this.fakePool]
      .sort(() => Math.random() - 0.5)
      .slice(0, target);

    pool.forEach((fp) => {
      const delay = 150 + Math.floor(Math.random() * 4500); // 0.15s .. 4.65s into 5s window
      const t = setTimeout(() => {
        if (this.currentRoundId !== roundId) return;
        if (this.realBettorsThisRound.size >= REAL_BETTOR_THRESHOLD) return;
        if (this.status !== "betting") return;
        this.placeFakeBet(fp, roundId);
      }, delay);
      this.fakeTimers.push(t);
    });
  }

  private placeFakeBet(fp: FakeUser, roundId: number) {
    // Bet between 10 KES and 10 000 KES, weighted toward the lower end.
    const r = Math.random();
    const kesAmount = Math.floor(10 + Math.pow(r, 2.2) * 9990);
    const amountCents = kesAmount * 100;
    const playerIndex = Math.random() < 0.5 ? 0 : 1;

    // 65% set an auto-cashout (1.20x..6.00x). Rest ride it bare.
    let autoCashout: number | null = null;
    if (Math.random() < 0.65) {
      autoCashout = +(1.2 + Math.random() * 4.8).toFixed(2);
    }

    const betId = -(++this.fakeBetSeq);
    const fb: FakeBet = {
      betId,
      userId: fp.id,
      masked: fp.masked,
      playerIndex,
      amount: amountCents,
      autoCashout,
      status: "active",
      cashedOut: false,
      createdAt: Date.now(),
    };
    this.currentRoundFakeBets.set(betId, fb);

    this.broadcast(wsEvents.SERVER_BET_PLACED, {
      bet: {
        id: betId,
        roundId,
        userId: fp.id,
        playerIndex,
        amount: amountCents,
        autoCashout,
        status: "active",
        createdAt: fb.createdAt,
      },
      user: { id: fp.id, username: fp.masked },
    });
  }

  private simulateFakeCashouts() {
    if (this.status !== "active" || !this.currentRoundId) return;
    const m = this.multiplier;
    this.currentRoundFakeBets.forEach((fb) => {
      if (fb.cashedOut || fb.status !== "active") return;
      if (
        fb.autoCashout &&
        m >= fb.autoCashout &&
        m < this.crashPoint
      ) {
        fb.cashedOut = true;
        fb.status = "won";
        const winAmount = Math.floor(fb.amount * fb.autoCashout);
        this.broadcast(wsEvents.SERVER_BET_CASHED_OUT, {
          bet: {
            id: fb.betId,
            roundId: this.currentRoundId,
            userId: fb.userId,
            playerIndex: fb.playerIndex,
            amount: fb.amount,
            autoCashout: fb.autoCashout,
            status: "won",
            cashoutMultiplier: fb.autoCashout,
            winAmount,
            createdAt: fb.createdAt,
          },
          user: { id: fb.userId, username: fb.masked },
          timestamp: Date.now(),
        });
      }
    });
  }

  /**
   * Look up the masked display name for a real user, with in-memory caching.
   */
  private async getMaskedForUser(userId: number): Promise<string> {
    const cached = this.userMaskCache.get(userId);
    if (cached) return cached;
    const u = await storage.getUser(userId);
    const masked = maskPhone(u?.phone) || u?.username || `Player ${userId}`;
    this.userMaskCache.set(userId, masked);
    return masked;
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
  // Provably-fair crash point
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

    const h = parseInt(hash.slice(0, 13), 16);
    const u = h / Math.pow(2, 52);

    if (u < INSTANT_BUST_CHANCE) {
      return 1.0;
    }

    const v = (u - INSTANT_BUST_CHANCE) / (1 - INSTANT_BUST_CHANCE);
    const residualEdge =
      (HOUSE_EDGE - INSTANT_BUST_CHANCE) / (1 - INSTANT_BUST_CHANCE);
    const fairFactor = Math.max(0, 1 - residualEdge);

    let crashPoint = fairFactor / (1 - v);

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
      this.realBettorsThisRound.clear();

      this.broadcast(wsEvents.SERVER_ROUND_START, {
        roundId: this.currentRoundId,
        serverSeedHash: this.serverSeedHash,
        ...this.getStatus(),
      });

      this.seedFakeBets(this.currentRoundId);

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

    // Trigger fake-player auto-cashouts as the multiplier climbs.
    this.simulateFakeCashouts();

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
  // Place Bet — debits from the shared wallet balance.
  // ────────────────────────────────────────────────
  public async placeBet(
    userId: number,
    playerIndex: number,
    amount: number,
    autoCashout?: number | null,
    saveNextBet: boolean = false,
  ) {
    if (!this.currentRoundId) throw new Error("No active round available");
    if (playerIndex < 0 || playerIndex > 1) throw new Error("Slot must be 1 or 2");

    if (!saveNextBet && this.status !== "betting") {
      throw new Error(
        "Cannot place immediate bet now — please queue for the next round",
      );
    }

    const newBalance = await storage.adjustWalletBalance(userId, -amount);
    if (newBalance === null) {
      throw new Error("Insufficient balance");
    }

    await storage.incrementUserWagered(userId, amount);

    const bet = await storage.placeBet(
      this.currentRoundId,
      userId,
      playerIndex,
      amount,
      autoCashout,
    );

    this.realBettorsThisRound.add(userId);
    const masked = await this.getMaskedForUser(userId);

    this.sendToUser(userId, wsEvents.SERVER_BALANCE_UPDATE, {
      walletBalance: newBalance,
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
      user: { id: userId, username: masked },
    });

    if (saveNextBet) {
      if (!this.nextBets[userId]) this.nextBets[userId] = {};
      this.nextBets[userId][playerIndex] = { amount, autoCashout };
    }

    return bet;
  }

  // ────────────────────────────────────────────────
  // Cashout — credits the shared wallet balance.
  // ────────────────────────────────────────────────
  public async handleCashout(
    userId: number,
    cashoutValue?: number,
    playerIndex: number = 0,
  ): Promise<number> {
    if (this.status !== "active") throw new Error("Round is not active");
    if (!this.currentRoundId) throw new Error("No active round");

    const activeBets = await storage.getActiveBets(this.currentRoundId);
    const bet = activeBets.find(
      (b) =>
        b.userId === userId &&
        b.status === "active" &&
        b.playerIndex === playerIndex,
    );

    if (!bet) throw new Error("No active bet found for this slot");

    const cashoutMultiplier = cashoutValue ?? this.multiplier;
    if (cashoutMultiplier > this.crashPoint + 0.001) {
      throw new Error("Cashout value exceeds crash point");
    }

    const winAmount = Math.floor(bet.amount * cashoutMultiplier);

    await storage.updateBetStatus(bet.id, "won", cashoutMultiplier, winAmount);
    const newBalance = await storage.adjustWalletBalance(userId, winAmount);
    const masked = await this.getMaskedForUser(userId);

    this.sendToUser(userId, wsEvents.SERVER_BALANCE_UPDATE, {
      walletBalance: newBalance ?? 0,
    });

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
      user: { id: userId, username: masked },
      timestamp: Date.now(),
    });

    return winAmount;
  }

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
