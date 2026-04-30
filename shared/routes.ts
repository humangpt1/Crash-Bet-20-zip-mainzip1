import { z } from "zod";
import {
  insertUserSchema,
  insertBetSchema,
  depositSchema,
  withdrawSchema,
  users,
  bets,
  rounds,
  transactions,
} from "./schema";

export const errorSchemas = {
  validation: z.object({ message: z.string(), field: z.string().optional() }),
  notFound: z.object({ message: z.string() }),
  internal: z.object({ message: z.string() }),
  unauthorized: z.object({ message: z.string() }),
  badRequest: z.object({ message: z.string() }),
};

export const api = {
  auth: {
    login: {
      method: "POST" as const,
      path: "/api/login" as const,
      input: z.object({
        phone: z.string().optional(),
        username: z.string().optional(),
        identifier: z.string().optional(),
        password: z.string(),
      }),
      responses: {
        200: z.custom<Omit<typeof users.$inferSelect, "password">>(),
        401: errorSchemas.unauthorized,
      },
    },
    register: {
      method: "POST" as const,
      path: "/api/register" as const,
      input: insertUserSchema,
      responses: {
        201: z.custom<Omit<typeof users.$inferSelect, "password">>(),
        400: errorSchemas.validation,
      },
    },
    me: {
      method: "GET" as const,
      path: "/api/me" as const,
      responses: {
        200: z.custom<Omit<typeof users.$inferSelect, "password">>(),
        401: errorSchemas.unauthorized,
      },
    },
    logout: {
      method: "POST" as const,
      path: "/api/logout" as const,
      responses: {
        200: z.object({ message: z.string() }),
      },
    },
  },
  game: {
    state: {
      method: "GET" as const,
      path: "/api/game/state" as const,
      responses: {
        200: z.object({
          status: z.enum(["betting", "active", "crashed"]),
          multiplier: z.number(),
          roundId: z.number().optional(),
          elapsed: z.number(),
          serverSeedHash: z.string().optional(),
        }),
      },
    },
    history: {
      method: "GET" as const,
      path: "/api/game/history" as const,
      responses: {
        200: z.array(z.custom<typeof rounds.$inferSelect>()),
      },
    },
  },
  bets: {
    place: {
      method: "POST" as const,
      path: "/api/bets" as const,
      input: insertBetSchema,
      responses: {
        201: z.custom<typeof bets.$inferSelect>(),
        400: errorSchemas.badRequest,
      },
    },
    cashout: {
      method: "POST" as const,
      path: "/api/bets/cashout" as const,
      input: z.object({
        playerIndex: z.number().min(0).max(1).optional().default(0),
      }),
      responses: {
        200: z.custom<typeof bets.$inferSelect>(),
        400: errorSchemas.badRequest,
      },
    },
    current: {
      method: "GET" as const,
      path: "/api/bets/current" as const,
      responses: {
        200: z.array(
          z.object({
            bet: z.custom<typeof bets.$inferSelect>(),
            user: z.object({ id: z.number(), username: z.string().nullable() }),
          }),
        ),
      },
    },
  },
  wallet: {
    summary: {
      method: "GET" as const,
      path: "/api/wallet" as const,
      responses: {
        200: z.object({
          totalBalance: z.number(),
          totalDeposited: z.number(),
          totalWagered: z.number(),
          totalWithdrawn: z.number(),
          wageringRequired: z.number(),
          wageringRemaining: z.number(),
          wageringMet: z.boolean(),
          dailyWithdrawn: z.number(),
          dailyLimit: z.number(),
          dailyRemaining: z.number(),
          minWithdrawal: z.number(),
          minDeposit: z.number(),
          canWithdraw: z.boolean(),
          withdrawBlockedReason: z.string().optional(),
          slots: z.array(z.any()),
        }),
      },
    },
    deposit: {
      method: "POST" as const,
      path: "/api/wallet/deposit" as const,
      input: depositSchema,
      responses: {
        200: z.object({
          ok: z.boolean(),
          message: z.string(),
          transactionId: z.number().optional(),
          reference: z.string().optional(),
        }),
        400: errorSchemas.badRequest,
      },
    },
    withdraw: {
      method: "POST" as const,
      path: "/api/wallet/withdraw" as const,
      input: withdrawSchema,
      responses: {
        200: z.object({
          ok: z.boolean(),
          message: z.string(),
          transactionId: z.number().optional(),
        }),
        400: errorSchemas.badRequest,
      },
    },
    transactions: {
      method: "GET" as const,
      path: "/api/wallet/transactions" as const,
      responses: {
        200: z.array(z.custom<typeof transactions.$inferSelect>()),
      },
    },
    webhook: {
      method: "POST" as const,
      path: "/api/wallet/webhook" as const,
      responses: {
        200: z.object({ status: z.string() }),
      },
    },
  },
};

export function buildUrl(
  path: string,
  params?: Record<string, string | number>,
): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export const wsEvents = {
  SERVER_STATE_UPDATE: "state_update",
  SERVER_ROUND_START: "round_start",
  SERVER_ROUND_CRASH: "round_crash",
  SERVER_BET_PLACED: "bet_placed",
  SERVER_BET_CASHED_OUT: "bet_cashed_out",
  SERVER_BALANCE_UPDATE: "balance_update",
  SERVER_WALLET_UPDATE: "wallet_update",
};
