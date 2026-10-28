# RailRush: train ticket booking

A full-stack train booking system built for **PS1: Ticket Booking System** (variant: **train**, the harder one).
Organisers publish trains and schedules. Travellers pick exact seats **for their stretch of the route**, hold them
while paying, and get a ticket. The same seat is never sold twice for the same stretch, even under heavy concurrency.

| Layer | Choice |
|---|---|
| Database | **PostgreSQL 16** (the seat guarantee is enforced by a primary key, see `docs/ARCHITECTURE.md`) |
| API | Node 22 + Express, plain JavaScript, `zod` validation, `pg` with parameterised SQL only |
| Frontend | React 18 + Vite, hand-written CSS, no UI kit |
| Run | Docker Compose (db, backend, frontend/nginx) |

## Run it (2 minutes)

```bash
docker compose up --build
```

| What | Where |
|---|---|
| App | http://localhost:8080 |
| API health | http://localhost:4000/api/health |
| Database | `localhost:5433` (Beekeeper Studio, see below) |

Demo data (6 trains, 30 days of runs, 3 accounts) is created on first start.

| Role | Email | Password |
|---|---|---|
| Traveller | `user@railrush.dev` | `User@12345` |
| Organiser | `organiser@railrush.dev` | `Organiser@123` |
| Second organiser (to test isolation) | `organiser2@railrush.dev` | `Organiser@123` |

New organisers register with the invite code `RAILRUSH-ORG-2026` (change it in `.env`, see `.env.example`).
The demo defaults are fine for a laptop. Copy `.env.example` to `.env` and set real secrets for anything else.

### Look inside the database with Beekeeper Studio

New connection → **PostgreSQL** → Host `localhost`, Port `5433`, User `railrush`, Password `railrush_dev_password`, Database `railrush`.
Tables worth opening: `seat_segments` (one row per seat per hop, the double-booking guard), `bookings`, `payments`, `audit_log`.

### Run without Docker (development)

```bash
# 1. a Postgres database you can reach, then:
cd backend && npm install
export DATABASE_URL=postgres://railrush:railrush_dev_password@localhost:5433/railrush
npm run dev              # migrates, seeds demo data, listens on :4000
# 2. in another terminal
cd frontend && npm install && npm run dev      # http://localhost:5173 (proxies /api to :4000)
```

### Run the tests

The tests need a real Postgres (that is the point: the guarantees live in the database). The database name must contain
`test`, because tests create and delete data.

```bash
docker compose up -d db
docker compose exec db createdb -U railrush railrush_test
cd backend && npm install
export TEST_DATABASE_URL=postgres://railrush:railrush_dev_password@localhost:5433/railrush_test
npm test                 # 30 tests: concurrency, rules, payments, security, dashboard
npm run test:load        # 150 users racing for 80 seat-hops, checks invariants
```

## A 5-minute tour for an evaluator

1. **Home**: the departure board is live data. Search Bengaluru to Hubballi for tomorrow.
2. **Seats**: open the seat map in two browser windows (one signed in as the traveller, one as a second traveller you register). Pick the same seat in both. The first to press *Hold seats and pay* wins, the other gets a clear message and the seat disappears from their map.
3. **Checkout**: watch the 5-minute hold timer. Tap the **Declined** demo card: the payment fails, nothing is charged, the seats stay held, you have 3 tries. Tap **Succeeds** to get the ticket (PNR + QR).
4. **My bookings**: *Cancel booking* shows the exact refund before you confirm (90 / 75 / 50 / 25% by time left).
5. **Organiser** (sign in as organiser): the dashboard shows revenue, refunds, seats sold and occupancy per run. *Runs → open a run* shows the passenger list and lets you cancel the run (everyone refunded 100%).
6. **Beekeeper**: run `SELECT * FROM seat_segments;` and watch rows appear and vanish as seats are held, bought and cancelled.

## Where each evaluation question is answered

| # | Question | Answer lives in |
|---|---|---|
| 1 | Users, what they can do, out of scope | [`docs/SCOPE.md`](docs/SCOPE.md) |
| 2 | Booking rules and edge cases | [`docs/BOOKING_RULES.md`](docs/BOOKING_RULES.md), each rule has a test in `backend/tests/booking.test.js` |
| 3 | Architecture and why each part | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| 4 | Data model, why SQL not MongoDB | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (ER diagram, `backend/src/db/schema.sql`) |
| 5 | How two users never get the same seat | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#how-two-users-never-get-the-same-seat), proven by the 30-user race test and `npm run test:load` |
| 6 | Full booking flow works end to end | The UI tour above; `6/10 full flow` test; API in [`docs/API.md`](docs/API.md) |
| 7 | Holds, retries, failed payments | [`docs/BOOKING_RULES.md`](docs/BOOKING_RULES.md#holds-and-payments), 7/10 tests |
| 8 | Cheating and data isolation | [`docs/SECURITY.md`](docs/SECURITY.md), 8/10 tests in `backend/tests/security.test.js` |
| 9 | Organiser dashboard correctness | [`docs/BOOKING_RULES.md`](docs/BOOKING_RULES.md#dashboard-definitions), `backend/tests/dashboard.test.js` checks hand-computed numbers |
| 10 | Deployed, runnable, testable, understandable | `docker compose up --build`, this README, [`docs/TESTING.md`](docs/TESTING.md) |

## Project layout

```
docker-compose.yml        db + backend + frontend
backend/
  src/db/                 schema.sql, migrate.js, seed.js, pool.js (transaction helper with deadlock retry)
  src/services/           bookings.js (hold/pay/cancel), availability.js, organiser.js, pricing.js, payment.js (mock), holds.js (sweeper)
  src/routes/             auth, public (search, seat map), bookings, organiser
  src/middleware/         auth (JWT cookie), validate (zod), origin (CSRF), errors
  tests/                  node:test suites + load.js
frontend/
  src/pages/              Home, Search, Book (seat map), Checkout, TicketPage, MyBookings, Auth, organiser/*
  src/components/         SeatMap, Board (live departures), SearchStub, StationPicker, BarChart
docs/                     scope, rules, architecture, security, API, testing
```
