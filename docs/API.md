# API reference

Base path `/api`. JSON in, JSON out. Session is an `HttpOnly` cookie (`rr_session`) set by login/register. `Authorization: Bearer <token>` also works for scripts.
Errors always look like `{ "error": { "code": "SEAT_UNAVAILABLE", "message": "…", "details": [...] } }`.

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness and database check |
| GET | `/stations` | All stations |
| GET | `/departures/next` | Next 7 departures with seats free end to end (home page board) |
| GET | `/trains/search?from=SBC&to=UBL&date=2026-10-29` | Trains for that boarding date, with fare and live free seats per class. Closed (inside the cut-off) departures are hidden |
| GET | `/runs/:runId/seats?from=SBC&to=UBL` | Seat map for **that journey**. Seat states: `AVAILABLE`, `HELD`, `BOOKED`, `MINE` (only when signed in) |

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{ name, email, password, organiserCode? }` | Role is `USER`, or `ORGANISER` with the right invite code. `role` field is rejected |
| POST | `/auth/login` | `{ email, password }` | 401 generic, 423 when locked, 429 when throttled |
| POST | `/auth/logout` | | Revokes all sessions of the user |
| GET | `/auth/me` | | Current user |

## Traveller (role `USER`)

| Method | Path | Body / header | Result |
|---|---|---|---|
| POST | `/bookings/hold` | `{ runId, from, to, passengers: [{ seatId, name, age, gender }] }` | **201** hold created (`PENDING`, `holdSecondsLeft`), **409** `SEAT_UNAVAILABLE` / `RUN_CANCELLED` / `BOOKING_CLOSED`, **422** invalid, **429** `TOO_MANY_HOLDS` |
| POST | `/bookings/:id/pay` | `Idempotency-Key` header + `{ method: "CARD", card: { number, expiry, cvv } }` or `{ method: "UPI", upi: { vpa } }` | **200** confirmed, **402** failed (`payment.failureCode`, `attemptsLeft`), **410** `HOLD_EXPIRED`, **409** `ALREADY_PAID` / `NOT_PAYABLE` |
| POST | `/bookings/:id/release` | | Free a hold |
| POST | `/bookings/:id/cancel` | | Cancel a paid booking, returns refund. **409** `ALREADY_DEPARTED` / `ALREADY_CANCELLED` |
| GET | `/bookings` | | My bookings (confirmed, live holds, cancelled) |
| GET | `/bookings/:id` | | One booking with passengers, hold timer and `refundIfCancelled` preview. **404** if it isn't yours |

## Organiser (role `ORGANISER`)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/organiser/dashboard?days=14` | | KPIs, daily sales/refunds, status counts, upcoming runs with occupancy, latest bookings |
| GET | `/organiser/trains` | | Own trains with routes and coaches |
| POST | `/organiser/trains` | `{ number, name, stops: [{ stationCode, arriveOffsetMin, departOffsetMin, distanceKm }], coaches: [{ code, class: "CC"\|"EC" }] }` | Seats are generated from the coach classes |
| POST | `/organiser/trains/:id/runs` | `{ startDate, days, departTime }` (IST) | Idempotent: existing runs are skipped |
| GET | `/organiser/runs?scope=upcoming\|past` | | Runs with seats sold, occupancy, net revenue |
| GET | `/organiser/runs/:id/manifest` | | Confirmed passenger list |
| POST | `/organiser/runs/:id/cancel` | `{ reason }` | Refunds everyone 100%, releases holds |

Try it with curl:

```bash
curl -c jar -H 'Content-Type: application/json' -d '{"email":"user@railrush.dev","password":"User@12345"}' http://localhost:4000/api/auth/login
curl -b jar "http://localhost:4000/api/trains/search?from=SBC&to=UBL&date=$(date -d tomorrow +%F)"
```
