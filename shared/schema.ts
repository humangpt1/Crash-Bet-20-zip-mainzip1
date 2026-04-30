import { sqliteTable, integer, real, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ----------------- USERS -----------------
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Username kept (legacy + admin) but no longer required for normal users.
  username: text("username").unique(),
  // Phone is the new primary identifier. Stored normalised as 254XXXXXXXXX.
  phone: text("phone").unique(),
  password: text("password").notNull(),
  isAdmin: integer("is_admin").notNull().default(0),
  // Wallet stats (cents/KES * 100)
  totalDeposited: integer("total_deposited").notNull().default(0),
  totalWagered: integer("total_wagered").notNull().default(0),
  totalWithdrawn: integer("total_withdrawn").notNull().default(0),
  // Fraud / safety
  isBlocked: integer("is_blocked").notNull().default(0),
  blockReason: text("block_reason"),
  lastIp: text("last_ip"),
  deviceFp: text("device_fp"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ----------------- SLOTS -----------------
// Two betting slots per user.
export const slots = sqliteTable("slots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  playerIndex: integer("player_index").notNull(),
  balance: integer("balance").notNull().default(0),
});

// ----------------- ROUNDS -----------------
export const rounds = sqliteTable("rounds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  crashPoint: real("crash_point").notNull(),
  serverSeed: text("server_seed").notNull(),
  // Server seed hash committed before round (revealed after)
  serverSeedHash: text("server_seed_hash"),
  clientSeed: text("client_seed").notNull(),
  nonce: integer("nonce").notNull(),
  status: text("status").notNull().default("pending"),
  startTime: integer("start_time").notNull().default(0),
  endTime: integer("end_time").notNull().default(0),
});

// ----------------- BETS -----------------
export const bets = sqliteTable("bets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  playerIndex: integer("player_index").notNull().default(0),
  roundId: integer("round_id").notNull(),
  amount: integer("amount").notNull(),
  cashoutMultiplier: real("cashout_multiplier"),
  autoCashout: real("auto_cashout"),
  winAmount: integer("win_amount"),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ----------------- TRANSACTIONS -----------------
// Both deposits and withdrawals.
export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    type: text("type").notNull(), // "deposit" | "withdrawal"
    amount: integer("amount").notNull(), // cents
    status: text("status").notNull().default("pending"), // pending|success|failed|cancelled
    phone: text("phone"),
    // Provider identifiers
    megapayRequestId: text("megapay_request_id"),
    megapayTransactionId: text("megapay_transaction_id"),
    mpesaReceipt: text("mpesa_receipt"),
    // Our reference passed to MegaPay
    reference: text("reference").notNull(),
    // Idempotency for webhooks
    idempotencyKey: text("idempotency_key"),
    failureReason: text("failure_reason"),
    rawWebhook: text("raw_webhook"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    completedAt: integer("completed_at"),
  },
  (t) => ({
    refIdx: uniqueIndex("transactions_reference_idx").on(t.reference),
    txIdIdx: index("transactions_megapay_tx_idx").on(t.megapayTransactionId),
    userTypeIdx: index("transactions_user_type_idx").on(t.userId, t.type),
  }),
);

// ----------------- WEBHOOK LOG -----------------
// Idempotency record per inbound webhook.
export const webhookLog = sqliteTable(
  "webhook_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull().default("megapay"),
    transactionId: text("transaction_id").notNull(),
    payload: text("payload").notNull(),
    receivedAt: integer("received_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    txUniq: uniqueIndex("webhook_log_provider_tx_idx").on(
      t.provider,
      t.transactionId,
    ),
  }),
);

// ----------------- FRAUD EVENTS -----------------
export const fraudEvents = sqliteTable("fraud_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  eventType: text("event_type").notNull(),
  severity: text("severity").notNull().default("info"), // info|warn|high|critical
  ip: text("ip"),
  deviceFp: text("device_fp"),
  details: text("details"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ----------------- ZOD SCHEMAS -----------------
// Kenyan phone normaliser → 254XXXXXXXXX (12 digits).
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

export const insertBetSchema = createInsertSchema(bets)
  .pick({
    amount: true,
    autoCashout: true,
    playerIndex: true,
  })
  .extend({
    amount: z.number().min(1),
    autoCashout: z.number().min(1.01).optional().nullable(),
    playerIndex: z.number().min(0).max(1).optional().default(0),
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
