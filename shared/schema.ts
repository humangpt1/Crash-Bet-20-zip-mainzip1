import {
  pgTable,
  serial,
  integer,
  bigint,
  real,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod";

// ----------------- USERS -----------------
// Single shared wallet — no per-slot balances anymore.
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique(),
  phone: text("phone").unique(),
  password: text("password").notNull(),
  isAdmin: integer("is_admin").notNull().default(0),
  // Single wallet (cents)
  walletBalance: integer("wallet_balance").notNull().default(0),
  // Wallet stats (cents)
  totalDeposited: integer("total_deposited").notNull().default(0),
  totalWagered: integer("total_wagered").notNull().default(0),
  totalWithdrawn: integer("total_withdrawn").notNull().default(0),
  // Fraud / safety
  isBlocked: integer("is_blocked").notNull().default(0),
  blockReason: text("block_reason"),
  lastIp: text("last_ip"),
  deviceFp: text("device_fp"),
  createdAt: bigint("created_at", { mode: "number" })
    .notNull()
    .default(sql`(extract(epoch from now()) * 1000)::bigint`),
});

// ----------------- ROUNDS -----------------
export const rounds = pgTable("rounds", {
  id: serial("id").primaryKey(),
  crashPoint: real("crash_point").notNull(),
  serverSeed: text("server_seed").notNull(),
  serverSeedHash: text("server_seed_hash"),
  clientSeed: text("client_seed").notNull(),
  nonce: integer("nonce").notNull(),
  status: text("status").notNull().default("pending"),
  startTime: bigint("start_time", { mode: "number" }).notNull().default(0),
  endTime: bigint("end_time", { mode: "number" }).notNull().default(0),
});

// ----------------- BETS -----------------
export const bets = pgTable("bets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // playerIndex (0/1) is just a UI slot identifier — both share the wallet.
  playerIndex: integer("player_index").notNull().default(0),
  roundId: integer("round_id").notNull(),
  amount: integer("amount").notNull(),
  cashoutMultiplier: real("cashout_multiplier"),
  autoCashout: real("auto_cashout"),
  winAmount: integer("win_amount"),
  status: text("status").notNull().default("active"),
  createdAt: bigint("created_at", { mode: "number" })
    .notNull()
    .default(sql`(extract(epoch from now()) * 1000)::bigint`),
});

// ----------------- TRANSACTIONS -----------------
export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    type: text("type").notNull(), // deposit | withdrawal
    amount: integer("amount").notNull(), // cents
    status: text("status").notNull().default("pending"), // pending|success|failed|cancelled
    phone: text("phone"),
    megapayRequestId: text("megapay_request_id"),
    megapayTransactionId: text("megapay_transaction_id"),
    mpesaReceipt: text("mpesa_receipt"),
    reference: text("reference").notNull(),
    idempotencyKey: text("idempotency_key"),
    failureReason: text("failure_reason"),
    rawWebhook: text("raw_webhook"),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .default(sql`(extract(epoch from now()) * 1000)::bigint`),
    completedAt: bigint("completed_at", { mode: "number" }),
  },
  (t) => ({
    refIdx: uniqueIndex("transactions_reference_idx").on(t.reference),
    txIdIdx: index("transactions_megapay_tx_idx").on(t.megapayTransactionId),
    userTypeIdx: index("transactions_user_type_idx").on(t.userId, t.type),
  }),
);

// ----------------- WEBHOOK LOG -----------------
export const webhookLog = pgTable(
  "webhook_log",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull().default("megapay"),
    transactionId: text("transaction_id").notNull(),
    payload: text("payload").notNull(),
    receivedAt: bigint("received_at", { mode: "number" })
      .notNull()
      .default(sql`(extract(epoch from now()) * 1000)::bigint`),
  },
  (t) => ({
    txUniq: uniqueIndex("webhook_log_provider_tx_idx").on(
      t.provider,
      t.transactionId,
    ),
  }),
);

// ----------------- FRAUD EVENTS -----------------
export const fraudEvents = pgTable("fraud_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  eventType: text("event_type").notNull(),
  severity: text("severity").notNull().default("info"),
  ip: text("ip"),
  deviceFp: text("device_fp"),
  details: text("details"),
  createdAt: bigint("created_at", { mode: "number" })
    .notNull()
    .default(sql`(extract(epoch from now()) * 1000)::bigint`),
});

// ----------------- ZOD SCHEMAS -----------------
export function normalisePhone(input: string): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return "254" + digits.slice(1);
  if (digits.startsWith("7") && digits.length === 9) return "254" + digits;
  if (digits.startsWith("1") && digits.length === 9) return "254" + digits;
  return null;
}

export const phoneSchema = z
  .string()
  .min(9)
  .max(15)
  .transform((v, ctx) => {
    const n = normalisePhone(v);
    if (!n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid Kenyan phone number (e.g. 0712345678)",
      });
      return z.NEVER;
    }
    return n;
  });

export const insertUserSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const insertAdminUserSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  isAdmin: z.number().default(1),
});

export const insertBetSchema = z.object({
  amount: z.number().int().min(1),
  autoCashout: z.number().min(1.01).optional().nullable(),
  playerIndex: z.number().int().min(0).max(1).optional().default(0),
});

export const depositSchema = z.object({
  amount: z.number().int().min(10).max(150000),
  phone: phoneSchema.optional(),
});

export const withdrawSchema = z.object({
  amount: z.number().int().min(100).max(150000),
  phone: phoneSchema.optional(),
});

// ----------------- TYPES -----------------
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Round = typeof rounds.$inferSelect;
export type Bet = typeof bets.$inferSelect;
export type InsertBet = z.infer<typeof insertBetSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type FraudEvent = typeof fraudEvents.$inferSelect;
