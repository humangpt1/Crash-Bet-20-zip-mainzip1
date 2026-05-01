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

### Welcome bonus

Every newly registered account is credited with **KES 50** (5 000 cents) immediately after `/api/register`. The bonus lands in `wallet_balance` only — `total_deposited` stays at `0`, so the existing "deposit before withdrawing" rule keeps the bonus locked as play-money until the user makes a real M-Pesa top-up.

## Live-bets simulator (fake players)

The live-bets feed is seeded with synthetic players so the room never looks empty.

- A pool of 80 fake users is built at boot (negative `id`s, randomised Kenyan-formatted phones).
- Every betting window seeds 22–31 fake bets, dripped over the 5-second window with random delays.
- Bets range KES 10 – 10 000, weighted toward the lower end. ~65 % carry an auto-cashout (1.20x – 6.00x); the rest ride bare.
- Auto-cashouts fire in real time as the multiplier climbs (broadcast as normal `bet_cashed_out` events).
- All public broadcasts include a **masked phone** as `user.username` (e.g. `0712****78`) — fake or real, it never leaks the full number.
- As soon as ≥ 20 distinct **real** players have placed a bet in the current round, every still-pending fake bet is cancelled and no new fakes are broadcast for that round.

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

## Referral system

- Every user gets a unique 6-char hex `referral_code` on registration.
- The referral link is `https://<host>/auth?ref=<code>` — visiting it pre-fills the referral code in the register form.
- When a new user signs up using a valid code, both the **referee** (new user, KES 50) and the **referrer** (existing user, KES 50) are credited immediately.
- Referral code and link are exposed via `GET /api/referral` (auth required).
- Referrers can share via the Share icon in the header → toggles a copy-link banner.

## House economics

| Mechanism | Detail |
|-----------|--------|
| `HOUSE_EDGE` | `0.50` — players' long-run EV ≈ 50 cents per KES staked |
| `INSTANT_BUST_CHANCE` | `0.35` — ~35 % of rounds bust at exactly 1.00x |
| **Force bust after high multiplier** | If the previous round's crash point was > 2.0x, the next round is forced to 1.00x regardless of RNG. Prevents two good rounds in a row. |
| **No consecutive wins** | Real players who cashed out in round N cannot cash out in round N+1 — manual or auto-cashout both blocked. Bet rides to the crash. |
| Fake player threshold | Fakes are suppressed once ≥ 20 real bettors join the round. |
| Online count floor | Always shows ≥ 30 online (realConnections + 28). |

## Online count

The green "online" pill in the header is broadcast in every `state_update` WS event. Floor of 30 even with 0 real users so the room always looks active.

## Withdrawal rules (new)

- Must have deposited AND placed at least one bet before withdrawing.
- Wagering requirement: 2× `total_deposited` must be wagered.
- Daily limit: KES 70 000.
- Min withdrawal: KES 100.

## Webhook URL

Configure in the MegaPay dashboard (Account Settings) to your deployment + `/api/wallet/webhook`. The handler is idempotent (unique `(provider, transactionId)` row in `webhook_log`).

**The exact webhook URL is printed to the console every time the server starts** — look for the `[webhook]` log line. Example:
```
[webhook] MegaPay webhook URL → https://your-domain.replit.dev/api/wallet/webhook
```

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
