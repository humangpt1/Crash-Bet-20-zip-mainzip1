import {
  users,
  rounds,
  bets,
  slots,
  transactions,
  webhookLog,
  fraudEvents,
  type User,
  type InsertUser,
  type Bet,
  type InsertBet,
  type Round,
  type Transaction,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, gte } from "drizzle-orm";

const SLOT_COUNT = 2;

type AdminUserInsert = { username: string; password: string; isAdmin: number };
type CreateUserInput = { phone: string; password: string; username?: string | null };

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

  async createUser(input: CreateUserInput): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        phone: input.phone,
        password: input.password,
        username: input.username ?? null,
      })
      .returning();
    return user;
  }

  async createAdminUser(adminUser: AdminUserInsert): Promise<User> {
    const [user] = await db.insert(users).values(adminUser).returning();
    return user;
  }

  async getAllUsers(): Promise<(User & { slots: any[] })[]> {
    const allUsers = await db.select().from(users);
    const usersWithSlots = await Promise.all(
      allUsers.map(async (user) => {
        const userSlots = await db
          .select()
          .from(slots)
          .where(eq(slots.userId, user.id));
        return { ...user, slots: userSlots };
      }),
    );
    return usersWithSlots;
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

  // -------- SLOTS --------
  async getSlot(userId: number, playerIndex: number) {
    const [slot] = await db
      .select()
      .from(slots)
      .where(and(eq(slots.userId, userId), eq(slots.playerIndex, playerIndex)));
    return slot;
  }

  async ensureSlots(userId: number) {
    const existing = await db.select().from(slots).where(eq(slots.userId, userId));
    if (existing.length < SLOT_COUNT) {
      const needed = Array.from({ length: SLOT_COUNT }, (_, i) => i).filter(
        (i) => !existing.some((s) => s.playerIndex === i),
      );
      for (const playerIndex of needed) {
        await db.insert(slots).values({ userId, playerIndex, balance: 0 });
      }
    }
  }

  async updateSlotBalance(userId: number, playerIndex: number, balance: number) {
    await db
      .update(slots)
      .set({ balance })
      .where(and(eq(slots.userId, userId), eq(slots.playerIndex, playerIndex)));
  }

  async getUserSlots(userId: number) {
    return await db
      .select()
      .from(slots)
      .where(eq(slots.userId, userId))
      .orderBy(slots.playerIndex);
  }

  /** Total balance across all slots for a user, in cents. */
  async getUserTotalBalance(userId: number): Promise<number> {
    const userSlots = await this.getUserSlots(userId);
    return userSlots.reduce((sum, s) => sum + (s.balance ?? 0), 0);
  }

  // -------- ADMIN BOOTSTRAP --------
  async createAdminIfNotExists(passwordHash: string): Promise<void> {
    const [existingAdmin] = await db
      .select()
      .from(users)
      .where(eq(users.username, "admin"));
    if (!existingAdmin) {
      await db.insert(users).values({
        username: "admin",
        password: passwordHash,
        isAdmin: 1,
      });
    }
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

  async updateRoundStatus(id: number, status: string, endTime?: Date): Promise<Round> {
    const endTimeMs = endTime ? endTime.getTime() : undefined;
    const [round] = await db
      .update(rounds)
      .set({ status, endTime: endTimeMs })
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
      .set({ status, cashoutMultiplier, winAmount })
      .where(eq(bets.id, id))
      .returning();
    return bet;
  }

  async getActiveBets(roundId: number): Promise<(Bet & { user: Omit<User, "password"> })[]> {
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

  async getTransactionByMegapayId(megapayTransactionId: string): Promise<Transaction | undefined> {
    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.megapayTransactionId, megapayTransactionId));
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

  /** Sum of completed withdrawals (and pending) within last 24h, cents. */
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
    return rows
      .filter((r: any) => r.amount != null)
      .reduce((sum, r: any) => sum + (r.amount ?? 0), 0);
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
  /** Returns true if newly inserted (not a duplicate). */
  async recordWebhook(
    provider: string,
    transactionId: string,
    payload: string,
  ): Promise<boolean> {
    try {
      await db.insert(webhookLog).values({ provider, transactionId, payload });
      return true;
    } catch (err: any) {
      // Unique-constraint violation = duplicate (idempotent skip)
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

  async countAccountsByIp(ip: string): Promise<number> {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.lastIp, ip));
    return rows.length;
  }
}

export const storage = new DatabaseStorage();
