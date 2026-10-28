# 8. Can a user cheat, or reach data that isn't theirs?

Short answer: no, and each claim below is backed by a test in `backend/tests/security.test.js` unless noted.

## Threat → control

| Threat | Control | Test |
|---|---|---|
| **Reading or changing someone else's booking** (IDOR) | Ownership is part of the SQL (`WHERE id = $1 AND user_id = $2`). Another user's booking is indistinguishable from a missing one: **404**, so ids can't even be confirmed. Applies to view, pay, release and cancel | *IDOR* |
| **Organiser reaching another organiser's data** | Every organiser query is scoped by `trains.organiser_id`. Foreign runs/trains return 404 for manifest, cancel and scheduling | *organisers are walled off* |
| **Privilege escalation** (user acts as organiser) | Role is checked in middleware from the **database**, not the token. Registration ignores any `role` field (strict schema rejects it). Organiser sign-up needs a secret invite code compared in constant time | *roles*, *privilege escalation* |
| **Organiser inflating own sales** | Organisers cannot book (403) | *roles* |
| **Price tampering / mass assignment** | The client never sends a price or status. Schemas are `.strict()`: unknown fields (`amountPaise`, `status`, `userId`…) are **rejected** (422). Fares are computed server-side from the database | *cheating* |
| **Seat tampering** | Seat ids are checked to belong to the run's train. Duplicates, unknown seats, wrong journeys are rejected | *booking rules* |
| **Double charge / replay** | `Idempotency-Key` required on pay. Booking row lock + unique "one SUCCESS per booking" index | *double-click*, *idempotency* |
| **Seat hoarding** | Max 2 live holds per user (race-safe), 5-minute expiry, rate limits on hold and pay | *hold limit*, *rate limiting* |
| **Paying for a seat you no longer hold** | Expiry is checked in SQL under the row lock. Late payment gets 410 and no payment is recorded | *expired hold* |
| **Forged / stolen sessions** | JWT `HS256` with a ≥32-char secret (the app **refuses to start** in production without one). Algorithm pinned (`alg: none` and wrong-secret tokens rejected). Token carries a version: **logout revokes every session**. The user is re-loaded from the DB on each request | *session tokens* |
| **XSS stealing the session** | Cookie is `HttpOnly` (JavaScript can't read it). React escapes output. Strict CSP from nginx and Helmet (`script-src 'self'`) | *login* (cookie flags), headers test |
| **CSRF** | Cookie is `SameSite=Strict`, **and** state-changing requests with a foreign `Origin` header are rejected. No CORS is enabled | *CSRF* |
| **Brute force / credential stuffing** | bcrypt (cost 12). Rate limit on auth. **Account lock** for 15 min after 5 failures (even the right password is refused while locked). Same error and similar timing for unknown email and wrong password | *login*, *rate limiting* |
| **SQL injection** | Every query is parameterised (`pg` placeholders). No string-built SQL anywhere. Inputs are also validated by strict `zod` schemas (station codes `^[A-Z]{2,5}$`, UUIDs, names by character class) | *injection* |
| **Card data exposure** | The full number is validated in memory and **discarded**. Only `•••• 1234` is stored. It is never logged or put in the audit log | *card data* |
| **Information leaks in errors** | Unknown errors return a generic 500 and are logged server-side only. No stack traces, no SQL. Bad JSON → 400, oversized body → 413 | *injection* (errors) |
| **Weak passwords** | 8–72 chars with upper, lower, digit. Duplicate emails rejected case-insensitively (unique index on `lower(email)`) | *privilege escalation* |
| **Clickjacking, MIME sniffing** | `X-Frame-Options: DENY` / `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy` | *security headers* |
| **Container compromise blast radius** | Backend runs as the unprivileged `node` user, frontend as `nginx-unprivileged`. Database port bound to `127.0.0.1` only | Dockerfiles, compose |
| **Secrets in the repo** | All secrets come from environment variables. `.env` is git-ignored. Dev secrets are random per process, never constants in code | `config.js` |

## Auditability

`audit_log` records holds, payments (success/failure), cancellations and run cancellations with user, entity and IP (no card data).

## Known limits (honest list)

- Sessions are 2-hour JWTs without refresh tokens. Logout revokes all sessions of that user.
- The demo compose file ships default demo secrets so it runs with one command. Set real values in `.env` for any real deployment, and serve over HTTPS with `COOKIE_SECURE=true`.
- The payment gateway is a simulation. A real one needs webhooks and reconciliation (the idempotent, row-locked flow is built for it).
- No email verification or password reset (out of scope, see `SCOPE.md`).
