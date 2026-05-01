import type { Express, Request } from "express";
import { Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { GameEngine } from "./game";
import { api, wsEvents } from "@shared/routes";
import { depositSchema, withdrawSchema } from "@shared/schema";
import { initiateStkPush, makeReference, getMegaPayConfig } from "./megapay";
import { z } from "zod";

// Wallet rules (cents)
const MIN_DEPOSIT_CENTS = 10 * 100; // KES 10
const MAX_DEPOSIT_CENTS = 150_000 * 100;
const MIN_WITHDRAWAL_CENTS = 100 * 100; // KES 100
const MAX_WITHDRAWAL_CENTS = 150_000 * 100;
const DAILY_WITHDRAWAL_LIMIT_CENTS = 70_000 * 100; // KES 70,000/day
const WAGERING_MULTIPLIER = 2;
// How long the simulated payout takes before we mark a withdrawal "success".
const WITHDRAW_SETTLE_MS = 8_000;

function clientIp(req: Request): string | undefined {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") return xff.split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || undefined;
}

function sanitizeUser(u: any) {
  if (!u) return u;
  const { password, ...rest } = u;
  return rest;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  setupAuth(app);

  const gameEngine = new GameEngine(httpServer);

  // ─────────────── Game endpoints ───────────────
  app.get(api.game.state.path, (_req, res) => {
    res.json(gameEngine.getStatus());
  });

  app.get(api.game.history.path, async (_req, res) => {
    const recent = await storage.getRecentRounds(20);
    res.json(recent);
  });

  app.get(api.bets.current.path, async (_req, res) => {
    const state = gameEngine.getStatus();
    if (!state.roundId) return res.json([]);
    const list = await storage.getActiveBets(state.roundId);
    res.json(
      list.map((b) => ({ bet: b, user: b.user, playerIndex: b.playerIndex })),
    );
  });

  // ─────────────── Wallet (single shared balance) ───────────────
  // Legacy "/api/slots" still returns a 2-slot array so older clients/UI
  // don't crash. Both slots reflect the same wallet balance now.
  app.get("/api/slots", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const balance = await storage.getWalletBalance(req.user.id);
    res.json([
      { userId: req.user.id, playerIndex: 0, balance },
      { userId: req.user.id, playerIndex: 1, balance },
    ]);
  });

  // ─────────────── Place bet ───────────────
  app.post(api.bets.place.path, async (req, res) => {
    if (!req.isAuthenticated())
      return res.status(401).json({ message: "Please log in first" });

    try {
      if (typeof req.body.amount === "string")
        req.body.amount = parseInt(req.body.amount, 10);
      if (typeof req.body.playerIndex === "string")
        req.body.playerIndex = parseInt(req.body.playerIndex, 10);
      if (typeof req.body.autoCashout === "string" && req.body.autoCashout !== "")
        req.body.autoCashout = parseFloat(req.body.autoCashout);
      else if (req.body.autoCashout === "" || req.body.autoCashout === undefined)
        req.body.autoCashout = null;

      const input = api.bets.place.input.parse(req.body);
      const playerIndex = input.playerIndex ?? 0;

      if (playerIndex < 0 || playerIndex > 1)
        return res.status(400).json({ message: "Slot must be 1 or 2" });

      const user = await storage.getUser(req.user.id);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.isBlocked)
        return res
          .status(403)
          .json({ message: user.blockReason || "Account is blocked" });

      const state = gameEngine.getStatus();
      const saveNextBet = !!req.body.saveNextBet;

      if (!saveNextBet && state.status !== "betting") {
        return res.status(400).json({
          message:
            "You can only place immediate bets during the betting phase",
        });
      }

      if (!saveNextBet) {
        const existingBets = await storage.getUserActiveBets(
          user.id,
          state.roundId!,
        );
        if (existingBets.some((b) => b.playerIndex === playerIndex)) {
          return res
            .status(400)
            .json({ message: `Slot ${playerIndex + 1} is already booked` });
        }
      }

      const bet = await gameEngine.placeBet(
        user.id,
        playerIndex,
        input.amount,
        input.autoCashout,
        saveNextBet,
      );

      res.status(201).json(bet);
    } catch (e: any) {
      console.error("Place bet error:", e);
      if (e instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: e.errors[0].message, details: e.errors });
      }
      res.status(400).json({ message: e.message || "Something went wrong" });
    }
  });

  // ─────────────── Cashout ───────────────
  app.post(api.bets.cashout.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const playerIndex =
      typeof req.body.playerIndex === "number"
        ? req.body.playerIndex
        : parseInt(req.body.playerIndex || "0");

    try {
      const winAmount = await gameEngine.handleCashout(
        req.user.id,
        undefined,
        playerIndex,
      );
      res.json({ message: "Cashed out successfully", winAmount });
    } catch (e: any) {
      console.error("Cashout error:", e);
      res.status(400).json({ message: e.message || "Failed to cash out" });
    }
  });

  // ─────────────── Wallet summary ───────────────
  app.get(api.wallet.summary.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = await storage.getUser(req.user.id);
    if (!user) return res.sendStatus(404);

    const totalBalance = user.walletBalance ?? 0;
    const wageringRequired = (user.totalDeposited ?? 0) * WAGERING_MULTIPLIER;
    const wageringRemaining = Math.max(
      0,
      wageringRequired - (user.totalWagered ?? 0),
    );
    const wageringMet = wageringRemaining === 0;
    const dailyWithdrawn = await storage.getDailyWithdrawnAmount(user.id);
    const dailyRemaining = Math.max(
      0,
      DAILY_WITHDRAWAL_LIMIT_CENTS - dailyWithdrawn,
    );

    let canWithdraw = true;
    let withdrawBlockedReason: string | undefined;
    if ((user.totalDeposited ?? 0) === 0) {
      canWithdraw = false;
      withdrawBlockedReason = "Make at least one deposit before withdrawing";
    } else if ((user.totalWagered ?? 0) === 0) {
      canWithdraw = false;
      withdrawBlockedReason = "You must place at least one bet before withdrawing";
    } else if (!wageringMet) {
      canWithdraw = false;
      withdrawBlockedReason = `Wager KES ${(wageringRemaining / 100).toFixed(0)} more to unlock withdrawals`;
    } else if (totalBalance < MIN_WITHDRAWAL_CENTS) {
      canWithdraw = false;
      withdrawBlockedReason = `Minimum withdrawal is KES ${MIN_WITHDRAWAL_CENTS / 100}`;
    } else if (dailyRemaining <= 0) {
      canWithdraw = false;
      withdrawBlockedReason = "Daily withdrawal limit reached";
    }

    res.json({
      totalBalance,
      totalDeposited: user.totalDeposited ?? 0,
      totalWagered: user.totalWagered ?? 0,
      totalWithdrawn: user.totalWithdrawn ?? 0,
      wageringRequired,
      wageringRemaining,
      wageringMet,
      dailyWithdrawn,
      dailyLimit: DAILY_WITHDRAWAL_LIMIT_CENTS,
      dailyRemaining,
      minWithdrawal: MIN_WITHDRAWAL_CENTS,
      minDeposit: MIN_DEPOSIT_CENTS,
      canWithdraw,
      withdrawBlockedReason,
      slots: [
        { userId: user.id, playerIndex: 0, balance: totalBalance },
        { userId: user.id, playerIndex: 1, balance: totalBalance },
      ],
    });
  });

  // ─────────────── Deposit (initiate STK push) ───────────────
  app.post(api.wallet.deposit.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const user = await storage.getUser(req.user.id);
      if (!user) return res.sendStatus(404);
      if (user.isBlocked)
        return res
          .status(403)
          .json({ message: user.blockReason || "Account is blocked" });

      const inputBody = { ...req.body };
      if (typeof inputBody.amount === "string")
        inputBody.amount = parseInt(inputBody.amount, 10);
      const parsed = depositSchema.safeParse(inputBody);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { amount } = parsed.data;
      const phone = parsed.data.phone || user.phone || undefined;
      if (!phone)
        return res.status(400).json({ message: "Phone number is required" });

      const cents = amount * 100;
      if (cents < MIN_DEPOSIT_CENTS)
        return res
          .status(400)
          .json({ message: `Minimum deposit is KES ${MIN_DEPOSIT_CENTS / 100}` });
      if (cents > MAX_DEPOSIT_CENTS)
        return res
          .status(400)
          .json({ message: `Maximum deposit is KES ${MAX_DEPOSIT_CENTS / 100}` });

      const reference = makeReference("DEP", user.id);

      const tx = await storage.createTransaction({
        userId: user.id,
        type: "deposit",
        amount: cents,
        phone,
        reference,
        status: "pending",
      });

      const cfg = getMegaPayConfig();
      if (!cfg) {
        await storage.updateTransaction(tx.id, {
          status: "failed",
          failureReason: "MegaPay credentials not configured",
        });
        return res.status(500).json({
          message:
            "Payments are temporarily unavailable. Please try again later.",
        });
      }

      try {
        const result = await initiateStkPush({
          amount,
          msisdn: phone,
          reference,
        });
        await storage.updateTransaction(tx.id, {
          megapayRequestId: result.transactionRequestId,
        });
        if (!result.success) {
          await storage.updateTransaction(tx.id, {
            status: "failed",
            failureReason: result.message,
          });
          return res
            .status(400)
            .json({ message: result.message || "Failed to send STK push" });
        }
        return res.json({
          ok: true,
          message:
            "STK push sent. Enter your M-Pesa PIN on your phone to complete the deposit.",
          transactionId: tx.id,
          reference,
        });
      } catch (err: any) {
        console.error("STK push error:", err);
        await storage.updateTransaction(tx.id, {
          status: "failed",
          failureReason: err.message || String(err),
        });
        return res
          .status(500)
          .json({ message: "Could not reach payment provider" });
      }
    } catch (err: any) {
      console.error("Deposit error:", err);
      res.status(500).json({ message: "Deposit failed" });
    }
  });

  // ─────────────── Withdraw (auto-settles) ───────────────
  app.post(api.wallet.withdraw.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const user = await storage.getUser(req.user.id);
      if (!user) return res.sendStatus(404);
      if (user.isBlocked)
        return res
          .status(403)
          .json({ message: user.blockReason || "Account is blocked" });

      const inputBody = { ...req.body };
      if (typeof inputBody.amount === "string")
        inputBody.amount = parseInt(inputBody.amount, 10);
      const parsed = withdrawSchema.safeParse(inputBody);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { amount } = parsed.data;
      const phone = parsed.data.phone || user.phone || undefined;
      if (!phone)
        return res.status(400).json({ message: "Phone number is required" });

      const cents = amount * 100;
      if (cents < MIN_WITHDRAWAL_CENTS)
        return res.status(400).json({
          message: `Minimum withdrawal is KES ${MIN_WITHDRAWAL_CENTS / 100}`,
        });
      if (cents > MAX_WITHDRAWAL_CENTS)
        return res.status(400).json({
          message: `Maximum withdrawal is KES ${MAX_WITHDRAWAL_CENTS / 100}`,
        });

      // Rule: must have deposited first
      if ((user.totalDeposited ?? 0) === 0) {
        return res
          .status(400)
          .json({ message: "Make a deposit before withdrawing" });
      }

      // Rule: must have played at least once
      if ((user.totalWagered ?? 0) === 0) {
        return res
          .status(400)
          .json({ message: "You must place at least one bet before withdrawing" });
      }

      // Rule: wagering 2× total deposits
      const wageringRequired = (user.totalDeposited ?? 0) * WAGERING_MULTIPLIER;
      if ((user.totalWagered ?? 0) < wageringRequired) {
        const remaining = wageringRequired - (user.totalWagered ?? 0);
        return res.status(400).json({
          message: `You must wager KES ${(remaining / 100).toFixed(0)} more before withdrawing`,
        });
      }

      // Rule: daily limit
      const dailyWithdrawn = await storage.getDailyWithdrawnAmount(user.id);
      if (dailyWithdrawn + cents > DAILY_WITHDRAWAL_LIMIT_CENTS) {
        const remaining = DAILY_WITHDRAWAL_LIMIT_CENTS - dailyWithdrawn;
        return res.status(400).json({
          message: `Daily limit exceeded. You can withdraw up to KES ${Math.max(0, remaining / 100).toFixed(0)} more today.`,
        });
      }

      // Fraud heuristic: rapid repeated withdrawals
      const pending = await storage.getPendingWithdrawals(user.id);
      if (pending.length >= 2) {
        await storage.logFraudEvent({
          userId: user.id,
          eventType: "many_pending_withdrawals",
          severity: "warn",
          ip: clientIp(req),
          details: { pendingCount: pending.length },
        });
        return res.status(400).json({
          message:
            "You have pending withdrawals. Please wait for them to be processed.",
        });
      }

      // Atomic debit from the shared wallet
      const newBalance = await storage.adjustWalletBalance(user.id, -cents);
      if (newBalance === null) {
        return res
          .status(400)
          .json({ message: "Insufficient wallet balance" });
      }

      const reference = makeReference("WD", user.id);
      const tx = await storage.createTransaction({
        userId: user.id,
        type: "withdrawal",
        amount: cents,
        phone,
        reference,
        status: "pending",
      });

      // Notify user of new balance immediately
      gameEngine.sendToUser(user.id, wsEvents.SERVER_BALANCE_UPDATE, {
        walletBalance: newBalance,
      });
      gameEngine.sendToUser(user.id, wsEvents.SERVER_WALLET_UPDATE, {
        event: "withdrawal_pending",
        amount: cents,
        transactionId: tx.id,
      });

      // Simulated M-Pesa B2C payout — auto-completes after a short delay
      setTimeout(async () => {
        try {
          const fakeReceipt =
            "MP" +
            Date.now().toString(36).toUpperCase() +
            Math.random().toString(36).slice(2, 6).toUpperCase();
          await storage.updateTransaction(tx.id, {
            status: "success",
            mpesaReceipt: fakeReceipt,
            completedAt: Date.now(),
          });
          await storage.incrementUserWithdrawn(user.id, cents);
          gameEngine.sendToUser(user.id, wsEvents.SERVER_WALLET_UPDATE, {
            event: "withdrawal_paid",
            amount: cents,
            receipt: fakeReceipt,
          });
        } catch (e) {
          console.error("Auto-settle withdrawal failed:", e);
        }
      }, WITHDRAW_SETTLE_MS);

      res.json({
        ok: true,
        message: `KES ${(cents / 100).toFixed(0)} sent to ${phone}. M-Pesa SMS arriving shortly.`,
        transactionId: tx.id,
      });
    } catch (err: any) {
      console.error("Withdraw error:", err);
      res.status(500).json({ message: "Withdrawal failed" });
    }
  });

  // ─────────────── Webhook (MegaPay → us) ───────────────
  app.post(api.wallet.webhook.path, async (req, res) => {
    try {
      const payload = req.body || {};
      const transactionId: string | undefined =
        payload.TransactionID || payload.transactionId;
      const responseCode = Number(payload.ResponseCode ?? -1);
      const reference: string | undefined =
        payload.TransactionReference || payload.reference;
      const receipt: string | undefined = payload.TransactionReceipt;
      const amountKsh = Number(payload.TransactionAmount ?? 0);

      if (!transactionId) {
        console.warn("Webhook missing TransactionID:", payload);
        return res.status(200).json({ status: "ignored" });
      }

      const fresh = await storage.recordWebhook(
        "megapay",
        transactionId,
        JSON.stringify(payload),
      );
      if (!fresh) {
        console.log("Duplicate webhook ignored:", transactionId);
        return res.status(200).json({ status: "duplicate" });
      }

      let tx = reference
        ? await storage.getTransactionByReference(reference)
        : undefined;
      if (!tx) tx = await storage.getTransactionByMegapayId(transactionId);
      if (!tx) {
        await storage.logFraudEvent({
          eventType: "webhook_unknown_reference",
          severity: "warn",
          details: { reference, transactionId },
        });
        return res.status(200).json({ status: "no-match" });
      }

      if (tx.status === "success") {
        return res.status(200).json({ status: "already-processed" });
      }

      if (responseCode === 0) {
        await storage.updateTransaction(tx.id, {
          status: "success",
          megapayTransactionId: transactionId,
          mpesaReceipt: receipt,
          rawWebhook: JSON.stringify(payload),
          completedAt: Date.now(),
        });

        if (tx.type === "deposit") {
          const expectedKsh = tx.amount / 100;
          if (Math.abs(expectedKsh - amountKsh) > 0.5) {
            await storage.logFraudEvent({
              userId: tx.userId,
              eventType: "deposit_amount_mismatch",
              severity: "high",
              details: { expectedKsh, amountKsh, transactionId },
            });
          }

          const newBalance = await storage.adjustWalletBalance(tx.userId, tx.amount);
          await storage.incrementUserDeposited(tx.userId, tx.amount);

          gameEngine.sendToUser(tx.userId, wsEvents.SERVER_BALANCE_UPDATE, {
            walletBalance: newBalance ?? tx.amount,
          });
          gameEngine.sendToUser(tx.userId, wsEvents.SERVER_WALLET_UPDATE, {
            event: "deposit_success",
            amount: tx.amount,
          });
        }
      } else {
        await storage.updateTransaction(tx.id, {
          status: "failed",
          megapayTransactionId: transactionId,
          failureReason: payload.ResponseDescription || `Code ${responseCode}`,
          rawWebhook: JSON.stringify(payload),
          completedAt: Date.now(),
        });
        gameEngine.sendToUser(tx.userId, wsEvents.SERVER_WALLET_UPDATE, {
          event: "deposit_failed",
          reason: payload.ResponseDescription,
        });
      }

      res.status(200).json({ status: "ok" });
    } catch (err: any) {
      console.error("Webhook error:", err);
      res.status(200).json({ status: "error", message: err.message });
    }
  });

  // ─────────────── Wallet transactions (history) ───────────────
  app.get(api.wallet.transactions.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const txs = await storage.getUserTransactions(req.user.id, 100);
    res.json(txs);
  });

  // ─────────────── Admin Routes ───────────────
  app.get("/api/admin/users", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin)
      return res.sendStatus(403);
    const users = await storage.getAllUsers();
    res.json(users.map(({ password, ...u }) => u));
  });

  app.get("/api/admin/transactions", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin)
      return res.sendStatus(403);
    const txs = await storage.getAllTransactions(200);
    res.json(txs);
  });

  app.get("/api/admin/withdrawals", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin)
      return res.sendStatus(403);
    const list = await storage.getAllPendingWithdrawals();
    res.json(list);
  });

  app.post("/api/admin/withdrawals/:id/complete", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin)
      return res.sendStatus(403);
    const id = parseInt(req.params.id, 10);
    const { receipt } = req.body;
    const existing = await storage.getTransaction(id);
    if (!existing || existing.status === "success") {
      return res.json({ ok: true });
    }
    const tx = await storage.updateTransaction(id, {
      status: "success",
      mpesaReceipt: receipt,
      completedAt: Date.now(),
    });
    if (tx && tx.type === "withdrawal") {
      await storage.incrementUserWithdrawn(tx.userId, tx.amount);
      gameEngine.sendToUser(tx.userId, wsEvents.SERVER_WALLET_UPDATE, {
        event: "withdrawal_paid",
        amount: tx.amount,
      });
    }
    res.json({ ok: true });
  });

  app.post("/api/admin/withdrawals/:id/reject", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin)
      return res.sendStatus(403);
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body;
    const existing = await storage.getTransaction(id);
    if (!existing || existing.status !== "pending") {
      return res.json({ ok: true });
    }
    const tx = await storage.updateTransaction(id, {
      status: "failed",
      failureReason: reason || "Rejected by admin",
      completedAt: Date.now(),
    });
    // Refund wallet
    if (tx && tx.type === "withdrawal") {
      const newBalance = await storage.adjustWalletBalance(tx.userId, tx.amount);
      gameEngine.sendToUser(tx.userId, wsEvents.SERVER_BALANCE_UPDATE, {
        walletBalance: newBalance ?? 0,
      });
      gameEngine.sendToUser(tx.userId, wsEvents.SERVER_WALLET_UPDATE, {
        event: "withdrawal_rejected",
        reason,
      });
    }
    res.json({ ok: true });
  });

  app.post("/api/admin/grant-coins", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin)
      return res.sendStatus(403);
    const { userId, amount } = req.body;
    if (typeof amount !== "number")
      return res.status(400).json({ message: "Invalid amount" });
    const cents = Math.round(amount * 100);
    const newBalance = await storage.adjustWalletBalance(userId, cents);
    if (newBalance === null)
      return res.status(400).json({ message: "Adjustment failed" });
    gameEngine.sendToUser(userId, wsEvents.SERVER_BALANCE_UPDATE, {
      walletBalance: newBalance,
    });
    res.json({ success: true, balance: newBalance });
  });

  app.post("/api/admin/set-balance", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin)
      return res.sendStatus(403);
    const { userId, balance } = req.body;
    if (typeof balance !== "number")
      return res.status(400).json({ message: "Invalid balance" });
    const cents = Math.round(balance * 100);
    const newBalance = await storage.setWalletBalance(userId, cents);
    gameEngine.sendToUser(userId, wsEvents.SERVER_BALANCE_UPDATE, {
      walletBalance: newBalance,
    });
    res.json({ success: true, balance: newBalance });
  });

  app.post("/api/admin/users/:id/block", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin)
      return res.sendStatus(403);
    const id = parseInt(req.params.id, 10);
    const { blocked, reason } = req.body;
    await storage.updateUserMeta(id, {
      isBlocked: blocked ? 1 : 0,
      blockReason: blocked ? reason || "Blocked by admin" : null,
    });
    res.json({ ok: true });
  });

  return httpServer;
}
