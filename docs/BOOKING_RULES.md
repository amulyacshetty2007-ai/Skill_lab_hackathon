# 2. Booking rules, including the edge cases

Every rule below is enforced **on the server** and has an automated test (file and test name in the right column).
Numbers are constants in `backend/src/config.js`.

## Journeys and seats

| Rule | Detail | Test |
|---|---|---|
| A booking is one train run, one boarding station, one destination | Destination must come **after** boarding on that train's route. Wrong direction or a station not on the route is rejected (422) | `booking`: *booking rules* |
| A seat is sold per **hop** | A seat sold A→B is still free B→C. A→C overlaps both | `booking`: *overlapping journeys* |
| 1 to **6** passengers per booking | Zero or seven is rejected. The same seat twice is rejected. A seat from another train is rejected | `booking`: *booking rules* |
| Passenger details | Name 2–60 letters, age 1–120, gender M/F/O. Every field is validated by the server | `security`: *injection and malformed input* |
| Search date means the date the train leaves **your boarding station**, in IST | A train leaving the origin at 23:00 and reaching your stop after midnight appears on the day you board | `booking`: *full flow* |

## Pricing

Fare per passenger = `round(rate_per_km × distance between your two stations) + reservation fee`, computed by the server from the database.

| Class | Rate | Reservation fee | Seats per coach |
|---|---|---|---|
| Chair Car (CC) | ₹1.10 / km | ₹30 | 40 (2+3) |
| Executive Chair (EC) | ₹2.30 / km | ₹50 | 20 (2+2) |

Money is stored in **paise as integers**, so there is no floating-point rounding. A client cannot send a price: any extra field is rejected (`security`: *cheating*).
Example: Bengaluru → Hubballi, 410 km, Chair Car = 45 100 + 3 000 paise = **₹481**.

## Booking window

| Rule | Detail | Test |
|---|---|---|
| Booking **closes 30 minutes before departure from your boarding station** | Uses the departure time of *your* stop, not the origin. A train that already left the origin can still be booked from a later stop | `booking`: *cut-off and departed trains* |
| Cancelled runs cannot be booked (409 `RUN_CANCELLED`) | | `booking`: *organiser cancels a run* |
| Organisers schedule up to 60 consecutive days per request; the date picker offers the next 30 days | | |

## Holds and payments

| Rule | Detail | Test |
|---|---|---|
| Choosing seats creates a **hold** for **5 minutes** | A hold is a `PENDING` booking that owns the seat-hops. Others see the seat as "held" | `booking`: *full flow* |
| Max **2 live holds per user** | Stops one person locking the whole train. Also holds when 5 requests arrive in parallel | `booking`: *hold limit* |
| Payment methods | Card or UPI (mock). Demo cards: `4242…4242` succeeds, `…0002` declined, `…9995` no funds, `…0119` gateway error. UPI ids starting `fail` are declined | `booking`: *failed payment* |
| A failed payment **keeps the hold** | Nothing is charged. The user can retry until the hold ends | `booking`: *failed payment keeps the hold* |
| **3** payment attempts, then the booking is `FAILED` and the seats are released | Another user can immediately buy them | `booking`: *three failed payments* |
| Hold ends → seats freed, `EXPIRED` | Freed three ways: lazily by the next buyer, by a background sweeper every 15 s, and by a late payment attempt | `booking`: *expired hold* (two tests) |
| Paying after the hold ended is refused (410 `HOLD_EXPIRED`) and **no payment row is created** | The check and the payment happen under one row lock, so there is no gap | `booking`: *expired hold* |
| Pay requires an `Idempotency-Key` header | Same key = same answer, **never a second charge**, and a replay does not use up an attempt | `booking`: *idempotency* |
| Double click / two tabs: 10 parallel pay calls → **one** success, nine get 409 `ALREADY_PAID` | Row lock on the booking plus a unique index "one successful payment per booking" | `booking`: *double-click* |
| User can **release** a hold (leave checkout) | Seats are freed at once. Releasing twice is harmless | `booking`: *release* |

## Cancellation and refunds

Refund = `floor(paid × percent)` by time left before **your boarding departure**:

| Time left | Refund |
|---|---|
| 48 h or more | 90% |
| 12 h to 48 h | 75% |
| 4 h to 12 h | 50% |
| under 4 h | 25% |
| train has departed | **cannot cancel** (409 `ALREADY_DEPARTED`) |

| Edge case | Behaviour | Test |
|---|---|---|
| Cancel twice | 409 `ALREADY_CANCELLED`, refund not paid twice | `booking`: *cancellation* |
| Cancel an unpaid hold | 409. Use release instead | `booking`: *cancellation* |
| Seats after cancelling | Go back on sale **immediately** (segments deleted in the same transaction) | `booking`: *cancellation* |
| Refund preview | My bookings shows the exact amount and tier **before** the user confirms | UI |
| Organiser cancels a run | Every confirmed booking is refunded **100%**, live holds are released, seats cleared, run closed. A departed run cannot be cancelled | `booking`: *organiser cancels a run* |

## Concurrency edge cases

| Situation | Outcome | Test |
|---|---|---|
| 30 users press *hold* on the same seat in the same instant | Exactly **1** succeeds, 29 get a clean 409, no stray rows | `booking`: *30 users* |
| 36 users race for overlapping journeys on 6 seats | Whatever wins, accepted bookings never share a seat-hop, row counts match exactly | `booking`: *racing overlapping* |
| Organiser cancels a run while someone is holding seats on it | The run row is locked, so a new hold cannot slip in after the cancel | by design (lock order, see `ARCHITECTURE.md`) |
| Two requests lock the same rows in opposite order | Rows are always inserted in the same (seat, hop) order, and any remaining deadlock is retried automatically | `tests/load.js` |

## Dashboard definitions

All figures are for the organiser's own trains only.

| Figure | Definition |
|---|---|
| Sales (gross) | Sum of amounts actually paid, over bookings that were paid (confirmed, or confirmed then cancelled) |
| Refunds | Sum of refund amounts |
| **Net revenue** | Sales − Refunds |
| Seats sold | Seats on currently confirmed bookings |
| Bookings | Count of currently confirmed bookings |
| Seats on hold | Seats in unexpired, unpaid holds |
| Occupancy of a run | Confirmed **seat-hops** ÷ (seats × hops). A seat sold for half the route counts as half |
| Daily chart | Sales by the day of payment, refunds by the day of cancellation (IST). When the chart window covers all activity, the bars add up exactly to the totals (asserted in `dashboard.test.js`) |

Unpaid, expired and failed bookings never count towards money. `dashboard.test.js` builds a scenario by hand
(2 confirmed, 1 user-cancelled at 90%, 1 organiser-cancelled at 100%, 1 live hold, 1 failed payment) and asserts every figure.
