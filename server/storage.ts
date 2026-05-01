import {
  users,
  rounds,
  bets,
  transactions,
  webhookLog,
  fraudEvents,
  type User,
  type Bet,
  type Round,
  type Transaction,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, gte } from "drizzle-orm";

type AdminUserInsert = { username: string; password: string; isAdmin: number };
type CreateUserInput = { phone: string; password: string; username?: string | null; referralCode?: string; referredBy?: number | null };

export class DatabaseStorage {
  // -------- USER --------
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    return user;
  }

  async getUserByPhone(phone: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.phone, phone));
    return user;
  }

  async getUserByReferralCode(code: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.referralCode, code.toUpperCase()));
    return user;
  }

  async createUser(input: CreateUserInput): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        phone: input.phone,
        password: input.password,
        username: input.username ?? null,
        referralCode: input.referralCode,
        referredBy: input.referredBy ?? null,
      })
      .returning();
    return user;
  }

  async createAdminUser(adminUser: AdminUserInsert & { phone?: string }): Promise<User> {
    const [user] = await db.insert(users).values(adminUser).returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.id));
  }

  async updateUserMeta(
    id: number,
    patch: Partial<Pick<User, "lastIp" | "deviceFp" | "isBlocked" | "blockReason">>,
  ): Promise<void> {
    await db.update(users).set(patch).where(eq(users.id, id));
  }

  async incrementUserDeposited(id: number, amount: number): Promise<void> {
    await db
      .update(users)
      .set({ totalDeposited: sql`${users.totalDeposited} + ${amount}` })
      .where(eq(users.id, id));
  }

  async incrementUserWagered(id: number, amount: number): Promise<void> {
    await db
      .update(users)
      .set({ totalWagered: sql`${users.totalWagered} + ${amount}` })
      .where(eq(users.id, id));
  }

  async incrementUserWithdrawn(id: number, amount: number): Promise<void> {
    await db
      .update(users)
      .set({ totalWithdrawn: sql`${users.totalWithdrawn} + ${amount}` })
      .where(eq(users.id, id));
  }

  // -------- WALLET (single shared balance) --------
  async getWalletBalance(userId: number): Promise<number> {
    const [u] = await db
      .select({ b: users.walletBalance })
      .from(users)
      .where(eq(users.id, userId));
    return u?.b ?? 0;
  }

  async setWalletBalance(userId: number, balance: number): Promise<number> {
    const safe = Math.max(0, Math.floor(balance));
    const [u] = await db
      .update(users)
      .set({ walletBalance: safe })
      .where(eq(users.id, userId))
      .returning({ b: users.walletBalance });
    return u?.b ?? 0;
  }

  /** Atomic credit/debit. Returns new balance, or null if insufficient funds. */
  async adjustWalletBalance(userId: number, delta: number): Promise<number | null> {
    if (delta >= 0) {
      const [u] = await db
        .update(users)
        .set({ walletBalance: sql`${users.walletBalance} + ${delta}` })
        .where(eq(users.id, userId))
        .returning({ b: users.walletBalance });
      return u?.b ?? null;
    }
    // Debit guarded by wallet_balance >= |delta|
    const need = -delta;
    const [u] = await db
      .update(users)
      .set({ walletBalance: sql`${users.walletBalance} - ${need}` })
      .where(and(eq(users.id, userId), gte(users.walletBalance, need)))
      .returning({ b: users.walletBalance });
    return u ? u.b : null;
  }

  // -------- ADMIN BOOTSTRAP --------
  async upsertAdminByPhone(
    phone: string,
    passwordHash: string,
    username: string,
  ): Promise<void> {
    const existing = await this.getUserByPhone(phone);
    if (existing) {
      await db
        .update(users)
        .set({ password: passwordHash, isAdmin: 1, username })
        .where(eq(users.id, existing.id));
      return;
    }
    await db.insert(users).values({
      phone,
      username,
      password: passwordHash,
      isAdmin: 1,
    });
  }

  // -------- ROUNDS --------
  async createRound(
    crashPoint: number,
    serverSeed: string,
    clientSeed: string,
    nonce: number,
    serverSeedHash?: string,
  ): Promise<Round> {
    const [round] = await db
      .insert(rounds)
      .values({
        crashPoint,
        serverSeed,
        serverSeedHash: serverSeedHash ?? null,
        clientSeed,
        nonce,
        status: "pending",
      })
      .returning();
    return round;
  }

  async updateRoundStatus(
    id: number,
    status: string,
    endTime?: Date,
  ): Promise<Round> {
    const endTimeMs = endTime ? endTime.getTime() : undefined;
    const [round] = await db
      .update(rounds)
      .set({ status, ...(endTimeMs ? { endTime: endTimeMs } : {}) })
      .where(eq(rounds.id, id))
      .returning();
    return round;
  }

  async getRecentRounds(limit = 20): Promise<Round[]> {
    return await db
      .select()
      .from(rounds)
      .where(eq(rounds.status, "crashed"))
      .orderBy(desc(rounds.id))
      .limit(limit);
  }

  // -------- BETS --------
  async placeBet(
    roundId: number,
    userId: number,
    playerIndex: number,
    amount: number,
    autoCashout?: number | null,
  ): Promise<Bet> {
    const [newBet] = await db
      .insert(bets)
      .values({
        userId,
        roundId,
        amount,
        autoCashout: autoCashout ?? null,
        playerIndex,
        status: "active",
      })
      .returning();
    return newBet;
  }

  async createBet(bet: any): Promise<Bet> {
    const [newBet] = await db
      .insert(bets)
      .values({
        userId: bet.userId,
        roundId: bet.roundId,
        amount: bet.amount,
        autoCashout: bet.autoCashout ?? null,
        playerIndex: bet.playerIndex ?? 0,
        status: "active",
      })
      .returning();
    return newBet;
  }

  async updateBetStatus(
    id: number,
    status: string,
    cashoutMultiplier?: number,
    winAmount?: number,
  ): Promise<Bet> {
    const [bet] = await db
      .update(bets)
      .set({
        status,
        ...(cashoutMultiplier !== undefined ? { cashoutMultiplier } : {}),
        ...(winAmount !== undefined ? { winAmount } : {}),
      })
      .where(eq(bets.id, id))
      .returning();
    return bet;
  }

  async getActiveBets(
    roundId: number,
  ): Promise<(Bet & { user: Omit<User, "password"> })[]> {
    const activeBets = await db
      .select({ bet: bets, user: users })
      .from(bets)
      .innerJoin(users, eq(bets.userId, users.id))
      .where(eq(bets.roundId, roundId));

    return activeBets.map((r) => {
      const { password, ...userWithoutPassword } = r.user;
      return { ...r.bet, user: userWithoutPassword };
    });
  }

  async getUserActiveBets(userId: number, roundId: number): Promise<Bet[]> {
    return await db
      .select()
      .from(bets)
      .where(and(eq(bets.userId, userId), eq(bets.roundId, roundId)));
  }

  // -------- TRANSACTIONS --------
  async createTransaction(input: {
    userId: number;
    type: "deposit" | "withdrawal";
    amount: number;
    phone?: string;
    reference: string;
    megapayRequestId?: string;
    status?: string;
  }): Promise<Transaction> {
    const [tx] = await db
      .insert(transactions)
      .values({
        userId: input.userId,
        type: input.type,
        amount: input.amount,
        phone: input.phone,
        reference: input.reference,
        megapayRequestId: input.megapayRequestId,
        status: input.status ?? "pending",
      })
      .returning();
    return tx;
  }

  async getTransactionByReference(reference: string): Promise<Transaction | undefined> {
    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.reference, reference));
    return tx;
  }

  async getTransactionByMegapayId(
    megapayTransactionId: string,
  ): Promise<Transaction | undefined> {
    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.megapayTransactionId, megapayTransactionId));
    return tx;
  }

  async getTransaction(id: number): Promise<Transaction | undefined> {
    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, id));
    return tx;
  }

  async updateTransaction(
    id: number,
    patch: Partial<Transaction>,
  ): Promise<Transaction> {
    const [tx] = await db
      .update(transactions)
      .set(patch)
      .where(eq(transactions.id, id))
      .returning();
    return tx;
  }

  async getUserTransactions(userId: number, limit = 50): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.id))
      .limit(limit);
  }

  async getAllTransactions(limit = 200): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.id))
      .limit(limit);
  }

  /** Sum of completed/pending withdrawals within last 24h, cents. */
  async getDailyWithdrawnAmount(userId: number): Promise<number> {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const rows = await db
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "withdrawal"),
          gte(transactions.createdAt, since),
        ),
      );
    return rows.reduce((sum, r: any) => sum + (r.amount ?? 0), 0);
  }

  async getPendingWithdrawals(userId: number): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "withdrawal"),
          eq(transactions.status, "pending"),
        ),
      );
  }

  async getAllPendingWithdrawals(): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "withdrawal"),
          eq(transactions.status, "pending"),
        ),
      )
      .orderBy(desc(transactions.id));
  }

  // -------- WEBHOOK LOG --------
  async recordWebhook(
    provider: string,
    transactionId: string,
    payload: string,
  ): Promise<boolean> {
    try {
      await db.insert(webhookLog).values({ provider, transactionId, payload });
      return true;
    } catch {
      return false;
    }
  }

  // -------- FRAUD --------
  async logFraudEvent(input: {
    userId?: number | null;
    eventType: string;
    severity?: "info" | "warn" | "high" | "critical";
    ip?: string;
    deviceFp?: string;
    details?: any;
  }): Promise<void> {
    await db.insert(fraudEvents).values({
      userId: input.userId ?? null,
      eventType: input.eventType,
      severity: input.severity ?? "info",
      ip: input.ip,
      deviceFp: input.deviceFp,
      details: input.details ? JSON.stringify(input.details) : null,
    });
  }

  async getRecentFraudEvents(limit = 100) {
    return await db
      .select()
      .from(fraudEvents)
      .orderBy(desc(fraudEvents.id))
      .limit(limit);
  }

  async countAccountsByIp(ip: string): Promise<number> {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.lastIp, ip));
    return rows.length;
  }
}

export const storage = new DatabaseStorage();
