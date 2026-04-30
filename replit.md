# CRASH.BET

Aviator-style crash betting web app for the Kenyan market with real M-Pesa deposits via MegaPay, simulated auto-settling withdrawals, and a heavily house-favoured provably-fair RNG.

## Stack

- **Backend**: Node 20, Express 5, TypeScript (`tsx`), `ws` for WebSockets, Passport (local strategy), express-session + memorystore.
- **Database**: **Neon Postgres** via `pg` + Drizzle ORM (`drizzle-orm/node-postgres`). Connection string read from `NEON_DATABASE_URL` (falls back to `DATABASE_URL` if unset).
- **Frontend**: React 18 + Vite 7 + TanStack Query + wouter + Tailwind 3 + Radix UI + lucide-react.
- **Payments**: MegaPay STK Push for deposits (`https://megapay.co.ke/backend/v1/initiatestk`); withdrawals are auto-settled in-app.

## Currency

All money in the database is stored as **integer cents** (1 KES = 100 cents). The frontend shows whole KES.

## Wallet model

**Single shared wallet per user** (`users.wallet_balance`). The two on-screen "slots" both draw from and credit back to the same pool. Atomic debit is guarded by a `wallet_balance >= amount` `WHERE` clause to prevent overdraw under concurrency.

## Auth

Phone (M-Pesa) + password. Phone is normalised to `254XXXXXXXXX`.
Admins can log in with phone OR username.

Bootstrap admin (created/refreshed on every boot):
- **Username**: `admin`
- **Phone**: `0746100508` (`254746100508`)
- **Password**: `12345678`

## Wallet rules

| Rule | Value |
|------|-------|
| Min deposit | KES 10 |
| Max deposit | KES 150 000 |
| Min withdrawal | KES 100 |
| Max withdrawal | KES 150 000 |
| Daily withdrawal limit | KES 70 000 / 24 h |
| Wagering requirement | 2 × `total_deposited` before any withdrawal |
| Concurrent pending withdrawals | max 2 |
| Withdrawal auto-settle delay | 8 s (then status flips to `success` with a generated M-Pesa receipt) |

## Game (provably fair)

For each round:
1. Fresh 256-bit `serverSeed` is generated; `serverSeedHash = SHA-256(serverSeed)` is committed and broadcast in `round_start`.
2. After the round crashes, the raw `serverSeed` is broadcast in `round_crash` for verification.
3. Crash point: HMAC-SHA-256(serverSeed, `clientSeed:nonce`) → first 13 hex → uniform `u ∈ [0,1)`.
   - With probability **3 %** → crash at `1.00x` (instant bust).
   - Otherwise crash = `(1 − residualEdge) / (1 − v)` where `v = (u − 0.03) / 0.97` and `residualEdge` makes total expected edge = **5 %**.
4. House edge ≈ 5 % regardless of cashout strategy. No rigging based on player profile.

## Routes (high level)

```
POST /api/register         { phone, password }
POST /api/login            { phone | username, password }
POST /api/logout
GET  /api/me

GET  /api/game/state
GET  /api/game/history
GET  /api/bets/current
POST /api/bets             { amount (cents), playerIndex 0|1, autoCashout?, saveNextBet? }
POST /api/bets/cashout     { playerIndex }

GET  /api/wallet                       wallet summary + rules
POST /api/wallet/deposit   { amount (KES whole), phone? }   → STK push
POST /api/wallet/withdraw  { amount (KES whole), phone? }   → queued for admin payout
GET  /api/wallet/transactions
POST /api/wallet/webhook   ← MegaPay → us (idempotent on TransactionID)

POST /api/admin/grant-coins
POST /api/admin/set-balance
GET  /api/admin/users
GET  /api/admin/withdrawals
POST /api/admin/withdrawals/:id/complete   { receipt }
POST /api/admin/withdrawals/:id/reject     { reason }
```

## Webhook URL

Configure in the MegaPay dashboard (Account Settings) to your deployment + `/api/wallet/webhook`. The handler is idempotent (unique `(provider, transactionId)` row in `webhook_log`).

## Withdrawals

The MegaPay withdrawal API is dashboard-only (per docs). Until they expose B2C, withdrawals are an internal queue:

1. User submits → balance is debited, `transactions` row created with `status = 'pending'`.
2. Admin views the queue at `GET /api/admin/withdrawals`, processes the M-Pesa payout in the MegaPay dashboard, then calls `complete` (with the M-Pesa receipt) or `reject` (auto-refunds balance).

## Fraud

`fraud_events` rows are written for:
- 3+ accounts on the same IP at registration time
- 2+ pending withdrawals attempted by the same user
- Webhook references that don't match any of our transactions
- Deposit amount mismatch between the request and the webhook

## Slots

Each user has exactly **2 betting slots** (player 1 and player 2). The frontend renders them in a 2-column grid. Slot 0 receives all deposits; withdrawals deduct from the largest-balance slot first.

## Dev / scripts

```bash
npm run dev             # tsx server/index.ts (port 5000)
npm run db:push -- --force   # sync schema to db.sqlite
```

The server hosts both the API and the Vite dev middleware on port 5000. Workflow `Start application` runs `npm run dev`.

## Known caveats

- Phone-based password reset is not yet implemented (no SMS provider wired). Users must remember their password or have an admin reset it.
- Real STK Push only works when the MegaPay-registered webhook URL is reachable. In dev, deposits will be created as `pending` and never confirmed unless you hit the webhook manually.
