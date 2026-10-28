# 1. Users, what they can do, and what is out of scope

## Roles

| Role | Who | Can do |
|---|---|---|
| **Traveller** (`USER`) | Anyone who registers | Search trains, see live seat availability, select seats, hold them, pay (mock), see the ticket (PNR and QR), list **My bookings**, cancel a paid booking and see the refund before confirming, release a hold, sign out |
| **Organiser** (`ORGANISER`) | A railway operator. Registers with a secret invite code | Create trains (route, timings, distances, coaches), schedule runs, see the **dashboard** (revenue, refunds, seats sold, occupancy, status mix), see each run's passenger list, cancel a whole run (everyone refunded in full) |
| **Visitor** (not signed in) | Anyone | Search trains and look at the seat map. Must sign in to hold seats |

Boundaries that follow from the roles:
- An organiser **cannot book tickets**. This stops an operator inflating its own revenue figures.
- An organiser sees **only their own trains**, runs and bookings. A traveller sees **only their own bookings**.
- Role is chosen by the server (invite code for organisers), never by a field the client sends.

## Variant chosen: train

A train is harder than a cinema or a concert because a seat is not sold "for the show" but **for a stretch of the route**.
A seat sold Bengaluru → Tumakuru is still free Tumakuru → Hubballi. The system models this exactly
(see `seat_segments` in `ARCHITECTURE.md`).

## Out of scope (deliberately)

| Not built | Why / what would change |
|---|---|
| Real payment gateway | The brief asks for a **mock** payment that can succeed or fail. The gateway call is isolated in `services/payment.js` and the flow is already idempotent, so a real gateway slots in there (plus a webhook for async confirmation) |
| Cancelling one passenger out of a multi-passenger booking | Whole-booking cancel only. Per-passenger refunds multiply the edge cases without adding to the core problem |
| Waiting list, RAC, Tatkal quotas, concessions, auto seat allocation | Product features on top of the same inventory model |
| Transfers across two trains | Each booking is one train, one boarding and one destination station |
| Email / SMS notifications | The confirmation is the on-screen ticket and My bookings |
| Password reset, email verification, 2FA | Would need a mail service. Session security that is built: see `SECURITY.md` |
| Real refunds to a bank | Refund amount is computed and recorded on the booking. Moving money is simulated |
| Platform / berth types (sleeper, AC tiers) | Two classes (Chair Car, Executive Chair) with seat grids. The class table is data-driven so more can be added |
| Multiple operators sharing one train | One train belongs to one organiser |
| Time zones other than IST | Railway time is shown in IST everywhere, whatever the viewer's device says |
