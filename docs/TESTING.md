# Testing, and how to run it (criteria 6, 7, 9, 10)

All tests run against a **real PostgreSQL**, through the real HTTP API (no mocks of the database). 30 tests plus a load test.

```bash
docker compose up -d db
docker compose exec db createdb -U railrush railrush_test
cd backend && npm install
export TEST_DATABASE_URL=postgres://railrush:railrush_dev_password@localhost:5433/railrush_test
npm test            # about 4 seconds
npm run test:load   # LOAD_USERS=150 LOAD_ROUNDS=4 by default
```

The runner refuses to start unless the database name contains `test`.
Each suite creates its own organiser, train and runs, so suites don't disturb each other or the demo data.

## What is covered

| File | Tests | Proves |
|---|---|---|
| `booking.test.js` | 15 | 30-way race on one seat → exactly 1 winner · overlapping journeys · racing overlaps never share a seat-hop · **full flow** (search → seat map → hold → pay → confirmed → My bookings) · failed payment keeps the hold · 3 failures release seats · idempotent replay · 10 parallel pays = 1 charge · expired hold freed and late payment refused · next buyer takes over an expired hold · hold limit · validation edge cases · booking cut-off · tiered refunds, double cancel, post-departure cancel · organiser run cancellation |
| `security.test.js` | 13 | 401s · role walls · IDOR · organiser isolation · price/mass-assignment tampering · privilege escalation · forged / `alg:none` / revoked tokens · cookie flags, lockout, no hash leaks · CSRF origin guard · SQLi, bad JSON, oversize bodies · card data never stored · rate limiting · headers |
| `dashboard.test.js` | 2 | A hand-built scenario (paid, cancelled at 90%, organiser-cancelled at 100%, live hold, failed payment) → every KPI, per-run figure, daily series and manifest equals the hand-computed value. Another organiser sees nothing. Cancelling frees occupancy |
| `load.js` | stress | 150 users × 4 rounds of random holds, payments and releases at the same time. Afterwards checks: **no duplicate seat-hop**, no segment owned by a dead booking, no more hops sold than exist, every confirmed booking owns exactly its hops |

Typical load result on a laptop-class machine:
`users=150 rounds=4 requests≈680 in ≈4s · accepted holds=80 · paid=60 · seat-hops sold=78/80 · duplicates=0`.

## Manual checks (also in the README tour)

1. Two browsers, same seat: only one hold succeeds, the other sees the seat vanish.
2. Declined demo card: error, hold kept, "2 tries left". Third failure: seats released.
3. Let the timer reach 0: the page shows the expired state, seats are free again, no charge.
4. Cancel: refund preview matches the amount recorded in the database (`bookings.refund_amount_paise`).
5. Organiser dashboard vs Beekeeper: `SELECT sum(paid_amount_paise), sum(refund_amount_paise) FROM bookings;` equals Sales and Refunds on the dashboard.

## Reproducible environment

- `docker compose up --build` starts everything with health checks (`db` healthy → backend → frontend).
- Schema and demo data are created automatically and idempotently on start (`migrate.js`, `seed.js`), guarded by an advisory lock so two containers can't collide.
- Lockfiles are committed, images pinned to major versions (`postgres:16`, `node:22`, `nginx-unprivileged:1.27`).
