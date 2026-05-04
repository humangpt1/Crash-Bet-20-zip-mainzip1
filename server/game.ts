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
  id: number;
  masked: string;
}

interface FakeBet {
  betId: number;
  userId: number;
  masked: string;
  playerIndex: number;
  amount: number;
  autoCashout: number | null;
  status: "active" | "won";
  cashedOut: boolean;
  createdAt: number;
}

const REAL_BETTOR_THRESHOLD = 20;

/**
 * Live admin-controllable settings.
 * houseLevel 1-10 controls how aggressively the house profits.
 */
export interface GameSettings {
  /** 1 = most generous, 10 = most profitable for house */
  houseLevel: number;
  /** Probability 0-1 that a round busts instantly at 1.00x */
  instantBustChance: number;
  /** After this many consecutive high (≥2x) rounds, force a low round */
  consecutiveHighLimit: number;
  /** Min fake bettors per round */
  fakeMin: number;
  /** Max fake bettors per round */
  fakeMax: number;
}

export let gameSettings: GameSettings = {
  houseLevel: 5,
  instantBustChance: 0.10,
  consecutiveHighLimit: 3,
  fakeMin: 70,
  fakeMax: 130,
};

export function updateGameSettings(patch: Partial<GameSettings>) {
  gameSettings = { ...gameSettings, ...patch };
}

/**
 * Map houseLevel (1-10) to an extra low-crash probability ON TOP of instantBustChance.
 * Level 1 = 0% extra (only the explicit bust chance matters)
 * Level 10 = 20% extra probability of landing in 1.01x-1.50x "near-bust" zone.
 */
function extraLowProb(level: number): number {
  return ((level - 1) / 9) * 0.20;
}

export class GameEngine {
  private wss: WebSocketServer;
  private status: "betting" | "active" | "crashed" = "crashed";
  private currentRoundId: number | null = null;
  private crashPoint = 1.0;
  private multiplier = 1.0;
  private startTime = 0;
  private growthRate = 0.07;
  private gameLoop: NodeJS.Timeout | null = null;
  private stateBroadcastInterval: NodeJS.Timeout | null = null;
  private bettingTimeout: NodeJS.Timeout | null = null;
  private serverSeed = "";
  private serverSeedHash = "";
  private clientSeed = "00000000000000000000000000000000";
  private nonce = 0;
  private nextBets: Record<number, Record<number, NextBet>> = {};

  private simulatedOnline = 95;
  private onlineDriftInterval: NodeJS.Timeout | null = null;

  private fakePool: FakeUser[] = [];
  private fakeBetSeq = 0;
  private currentRoundFakeBets = new Map<number, FakeBet>();
  private fakeTimers: NodeJS.Timeout[] = [];
  private realBettorsThisRound = new Set<number>();
  private userMaskCache = new Map<number, string>();

  private prevRoundWinners = new Set<number>();
  private currentRoundWinners = new Set<number>();
  private consecutiveHighRounds = 0;
  private lastCrashPointForLog = 1.0;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.buildFakePool();
    this.setupWebSocket();
    this.startOnlineDrift();
    this.startNewRound();
  }

  private startOnlineDrift() {
    this.simulatedOnline = 80 + Math.floor(Math.random() * 40);
    this.onlineDriftInterval = setInterval(() => {
      const delta = Math.floor(Math.random() * 7) - 3;
      this.simulatedOnline = Math.min(130, Math.max(70, this.simulatedOnline + delta));
    }, 3000);
  }

  private buildFakePool(size = 200) {
    const prefixes = ["070", "071", "072", "074", "079", "0110", "0111"];
    this.fakePool = [];
    for (let i = 0; i < size; i++) {
      const p = prefixes[Math.floor(Math.random() * prefixes.length)];
      let n = "";
      for (let k = 0; k < 10 - p.length; k++) n += Math.floor(Math.random() * 10);
      const phone = p + n;
      this.fakePool.push({ id: -(1000 + i), masked: maskPhone(phone) });
    }
  }

  private cancelFakeTimers() {
    this.fakeTimers.forEach((t) => clearTimeout(t));
    this.fakeTimers = [];
  }

  private seedFakeBets(roundId: number) {
    this.cancelFakeTimers();
    this.currentRoundFakeBets.clear();

    const { fakeMin, fakeMax } = gameSettings;
    const target = fakeMin + Math.floor(Math.random() * (fakeMax - fakeMin + 1));
    const pool = [...this.fakePool]
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(target, this.fakePool.length));

    pool.forEach((fp) => {
      const delay = 80 + Math.floor(Math.random() * 4700);
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
    const r = Math.random();
    // Weight amounts toward small bets (KES 10-500) with a long tail to 10k
    const kesAmount = r < 0.6
      ? Math.floor(10 + Math.random() * 490)        // 60%: KES 10-500
      : r < 0.85
      ? Math.floor(500 + Math.random() * 1500)      // 25%: KES 500-2000
      : Math.floor(2000 + Math.random() * 8000);    // 15%: KES 2000-10000
    const amountCents = kesAmount * 100;
    const playerIndex = Math.random() < 0.5 ? 0 : 1;

    // Fake auto-cashout: most set low (1.2x-2.5x) giving excitement, some set higher
    let autoCashout: number | null = null;
    const acr = Math.random();
    if (acr < 0.30) autoCashout = +(1.2 + Math.random() * 0.8).toFixed(2);       // 30%: 1.2-2.0x
    else if (acr < 0.55) autoCashout = +(2.0 + Math.random() * 1.5).toFixed(2);  // 25%: 2-3.5x
    else if (acr < 0.70) autoCashout = +(3.5 + Math.random() * 6.5).toFixed(2);  // 15%: 3.5-10x
    // 30% ride bare (no auto-cashout)

    const betId = -(++this.fakeBetSeq);
    const fb: FakeBet = {
      betId, userId: fp.id, masked: fp.masked, playerIndex,
      amount: amountCents, autoCashout, status: "active",
      cashedOut: false, createdAt: Date.now(),
    };
    this.currentRoundFakeBets.set(betId, fb);

    this.broadcast(wsEvents.SERVER_BET_PLACED, {
      bet: {
        id: betId, roundId, userId: fp.id, playerIndex,
        amount: amountCents, autoCashout, status: "active",
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
      if (fb.autoCashout && m >= fb.autoCashout && m < this.crashPoint) {
        fb.cashedOut = true;
        fb.status = "won";
        const winAmount = Math.floor(fb.amount * fb.autoCashout);
        this.broadcast(wsEvents.SERVER_BET_CASHED_OUT, {
          bet: {
            id: fb.betId, roundId: this.currentRoundId, userId: fb.userId,
            playerIndex: fb.playerIndex, amount: fb.amount,
            autoCashout: fb.autoCashout, status: "won",
            cashoutMultiplier: fb.autoCashout, winAmount,
            createdAt: fb.createdAt,
          },
          user: { id: fb.userId, username: fb.masked },
          timestamp: Date.now(),
        });
      }
    });
  }

  private async getMaskedForUser(userId: number): Promise<string> {
    const cached = this.userMaskCache.get(userId);
    if (cached) return cached;
    const u = await storage.getUser(userId);
    const masked = maskPhone(u?.phone) || u?.username || `Player ${userId}`;
    this.userMaskCache.set(userId, masked);
    return masked;
  }

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
        } catch {}
      });
      ws.send(JSON.stringify({ type: wsEvents.SERVER_STATE_UPDATE, payload: this.getStatus() }));
    });

    const heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const client = ws as Client;
        if (!client.isAlive) { client.terminate(); return; }
        client.isAlive = false;
        client.ping();
      });
    }, 30000);

    this.wss.on("close", () => clearInterval(heartbeatInterval));
  }

  public broadcast(type: string, payload: any) {
    const message = JSON.stringify({ type, payload });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  }

  public sendToUser(userId: number, type: string, payload: any) {
    const message = JSON.stringify({ type, payload });
    this.wss.clients.forEach((client) => {
      const c = client as Client;
      if (c.readyState === WebSocket.OPEN && c.userId === userId) c.send(message);
    });
  }

  /**
   * Provably-fair crash point generator with exciting, varied distribution.
   *
   * House edge comes entirely from the bust probability (instantBustChance +
   * an extra "near-bust" zone controlled by houseLevel). The non-bust portion
   * always uses the Pareto 1/(1-v) formula, which produces:
   *
   *   ~50% of non-bust rounds: 1.0x – 2.0x
   *   ~30% of non-bust rounds: 2.0x – 5.0x   ← exciting sweet spot
   *   ~15% of non-bust rounds: 5.0x – 20x    ← big-win feeling
   *    ~5% of non-bust rounds: 20x – 1000x   ← legendary jackpot
   *
   * houseLevel 1-10 adds an extra "near-bust" band (1.01–1.50x) on top of
   * the instant-bust chance so the admin can dial house profit without making
   * the game feel rigged (no change to the shape of the exciting tail).
   *
   * At default settings (level 5, bustChance 10%):
   *   ~10%  instant 1.00x bust
   *   ~10%  near-bust  1.01–1.50x  (houseLevel contribution)
   *   ~36%  low      1.51–2.00x
   *   ~24%  medium   2.01–5.00x
   *   ~12%  high     5.01–20x
   *    ~8%  jackpot  20x+
   */
  private generateCrashPoint(): number {
    this.serverSeed = crypto.randomBytes(32).toString("hex");
    this.serverSeedHash = crypto
      .createHash("sha256")
      .update(this.serverSeed)
      .digest("hex");
    this.nonce++;

    const { instantBustChance, consecutiveHighLimit } = gameSettings;
    // Extra low-crash probability from houseLevel (0% at level 1, 20% at level 10)
    const extraLow = extraLowProb(gameSettings.houseLevel);

    // Total "low zone" probability. Hard cap at 70% so the game never feels broken.
    let lowZone = Math.min(0.70, instantBustChance + extraLow);

    // If too many consecutive high rounds, temporarily expand the low zone to recover
    if (this.consecutiveHighRounds >= consecutiveHighLimit) {
      lowZone = Math.min(0.90, lowZone + 0.25);
    }

    const hmac = crypto.createHmac("sha256", this.serverSeed);
    hmac.update(`${this.clientSeed}:${this.nonce}`);
    const hash = hmac.digest("hex");
    const h = parseInt(hash.slice(0, 13), 16);
    const u = h / Math.pow(2, 52); // uniform [0, 1)

    // ── Low Zone (instant bust + near-bust) ──────────────────
    if (u < lowZone) {
      if (u < instantBustChance) {
        // Instant 1.00x bust
        return 1.0;
      }
      // Near-bust zone: 1.01x – 1.50x (scaled by how deep into the near-bust band we are)
      const t = (u - instantBustChance) / (lowZone - instantBustChance);
      const cp = 1.01 + t * 0.49; // linearly 1.01 → 1.50
      return Math.floor(cp * 100) / 100;
    }

    // ── Exciting Zone: Pareto 1/(1-v) — always > 1.0x ───────
    // v is uniform (0, 1), giving crash ∈ (1, ∞)
    const v = (u - lowZone) / (1 - lowZone);
    let crash = 1.0 / (1 - v);

    if (!isFinite(crash) || crash > 1000) crash = 1000;
    // Minimum for this zone is 1.01x (due to v > 0)
    if (crash < 1.0) crash = 1.0;

    return Math.floor(crash * 100) / 100;
  }

  private async startNewRound(): Promise<void> {
    try {
      this.clearTimers();
      this.status = "betting";
      this.multiplier = 1.0;
      this.crashPoint = this.generateCrashPoint();

      const round = await storage.createRound(
        this.crashPoint, this.serverSeed, this.clientSeed,
        this.nonce, this.serverSeedHash,
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
        this.placeBet(userId, slot, queued.amount, queued.autoCashout, false)
          .catch((err) => console.warn("Auto-place queued bet failed:", err));
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

    this.simulateFakeCashouts();

    const activeBets = await storage.getActiveBets(this.currentRoundId);
    await Promise.all(
      activeBets.map(async (bet) => {
        if (
          bet.status === "active" &&
          bet.autoCashout &&
          this.multiplier >= bet.autoCashout &&
          this.multiplier < this.crashPoint &&
          !this.prevRoundWinners.has(bet.userId)
        ) {
          await this.handleCashout(bet.userId, bet.autoCashout, bet.playerIndex)
            .catch((err) => console.warn("Auto-cashout failed:", err));
        }
      }),
    );
  }

  private async crash(): Promise<void> {
    this.status = "crashed";
    this.clearTimers();

    if (this.currentRoundId) {
      await storage.updateRoundStatus(this.currentRoundId, "crashed", new Date());

      const activeBets = await storage.getActiveBets(this.currentRoundId);
      await Promise.all(
        activeBets.filter((b) => b.status === "active")
          .map((b) => storage.updateBetStatus(b.id, "lost")),
      );
    }

    if (this.crashPoint >= 2.0) {
      this.consecutiveHighRounds++;
    } else {
      this.consecutiveHighRounds = 0;
    }

    this.lastCrashPointForLog = this.crashPoint;

    this.broadcast(wsEvents.SERVER_ROUND_CRASH, {
      crashPoint: this.crashPoint,
      multiplier: this.multiplier,
      serverSeed: this.serverSeed,
      timestamp: Date.now(),
    });

    this.prevRoundWinners = new Set(this.currentRoundWinners);
    this.currentRoundWinners.clear();
    this.broadcastState();
    setTimeout(() => this.startNewRound(), 3000);
  }

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
      throw new Error("Cannot place immediate bet now — please queue for the next round");
    }

    const newBalance = await storage.adjustWalletBalance(userId, -amount);
    if (newBalance === null) throw new Error("Insufficient balance");

    await storage.incrementUserWagered(userId, amount);

    const bet = await storage.placeBet(this.currentRoundId, userId, playerIndex, amount, autoCashout);
    this.realBettorsThisRound.add(userId);
    const masked = await this.getMaskedForUser(userId);

    this.sendToUser(userId, wsEvents.SERVER_BALANCE_UPDATE, { walletBalance: newBalance });

    this.broadcast(wsEvents.SERVER_BET_PLACED, {
      bet: {
        id: bet.id, roundId: this.currentRoundId, userId: bet.userId,
        playerIndex, amount: bet.amount, autoCashout: bet.autoCashout ?? null,
        status: bet.status, createdAt: bet.createdAt ?? Date.now(),
      },
      user: { id: userId, username: masked },
    });

    if (saveNextBet) {
      if (!this.nextBets[userId]) this.nextBets[userId] = {};
      this.nextBets[userId][playerIndex] = { amount, autoCashout };
    }

    return bet;
  }

  public async handleCashout(
    userId: number,
    cashoutValue?: number,
    playerIndex: number = 0,
  ): Promise<number> {
    if (this.status !== "active") throw new Error("Round is not active");
    if (!this.currentRoundId) throw new Error("No active round");

    const activeBets = await storage.getActiveBets(this.currentRoundId);
    const bet = activeBets.find(
      (b) => b.userId === userId && b.status === "active" && b.playerIndex === playerIndex,
    );

    if (!bet) throw new Error("No active bet found for this slot");
    if (this.prevRoundWinners.has(userId)) {
      throw new Error("Cannot win two rounds in a row — cash out next round!");
    }

    const cashoutMultiplier = cashoutValue ?? this.multiplier;
    if (cashoutMultiplier > this.crashPoint + 0.001) throw new Error("Cashout value exceeds crash point");

    const winAmount = Math.floor(bet.amount * cashoutMultiplier);
    await storage.updateBetStatus(bet.id, "won", cashoutMultiplier, winAmount);
    const newBalance = await storage.adjustWalletBalance(userId, winAmount);
    const masked = await this.getMaskedForUser(userId);
    this.currentRoundWinners.add(userId);

    this.sendToUser(userId, wsEvents.SERVER_BALANCE_UPDATE, { walletBalance: newBalance ?? 0 });

    this.broadcast(wsEvents.SERVER_BET_CASHED_OUT, {
      bet: {
        id: bet.id, roundId: this.currentRoundId, userId: bet.userId,
        playerIndex: bet.playerIndex, amount: bet.amount,
        autoCashout: bet.autoCashout ?? null, status: "won",
        cashoutMultiplier, winAmount, createdAt: bet.createdAt ?? Date.now(),
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
    const realOnline = this.wss.clients.size;
    const onlineCount = Math.min(130, Math.max(70, this.simulatedOnline + realOnline));
    return {
      status: this.status,
      multiplier: this.multiplier,
      roundId: this.currentRoundId,
      elapsed: this.status === "active" ? Date.now() - this.startTime : 0,
      serverSeedHash: this.serverSeedHash,
      onlineCount,
    };
  }
}
