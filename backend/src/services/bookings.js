import { pool, query, withTx } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError } from '../utils/httpError.js';
import { newPnr } from '../utils/pnr.js';
import { loadStops, resolveJourney } from './availability.js';
import { expireHolds } from './holds.js';
import { fareFor, refundAmount, refundPercent } from './pricing.js';
import { chargeCard, chargeUpi, FAILURES } from './payment.js';

const audit = (db, userId, action, entity, entityId, meta, ip) =>
  db.query('INSERT INTO audit_log (user_id, action, entity, entity_id, meta, ip) VALUES ($1,$2,$3,$4,$5,$6)',
    [userId, action, entity, entityId, meta ? JSON.stringify(meta) : null, ip || null]);

/* ------------------------------------------------------------------ HOLD */
export async function createHold(user, { runId, from, to, passengers }, ip) {
  const id = await withTx(async (c) => {
    // 1. Serialise this user's own hold requests so the "max active holds" rule can't be raced with parallel calls.
    await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);

    // 2. Share-lock the run: an organiser cancelling the run (FOR UPDATE) can't interleave with a new hold.
    const run = (await c.query(
      'SELECT id, train_id, start_at, status FROM train_runs WHERE id = $1 FOR SHARE', [runId])).rows[0];
    if (!run) throw new HttpError(404, 'RUN_NOT_FOUND', 'Run not found');
    if (run.status !== 'SCHEDULED') throw new HttpError(409, 'RUN_CANCELLED', 'This train run has been cancelled');

    const stops = await loadStops(c, run.train_id);
    const j = resolveJourney(stops, from, to);

    const cutoff = (await c.query(
      `SELECT (($1::timestamptz + make_interval(mins => $2)) - make_interval(mins => $3)) <= now() AS closed`,
      [run.start_at, j.from.depart_offset_min, config.bookingCutoffMinutes])).rows[0];
    if (cutoff.closed) throw new HttpError(409, 'BOOKING_CLOSED', `Booking closes ${config.bookingCutoffMinutes} minutes before departure`);

    // 3. Seats must exist, belong to THIS train and not repeat.
    const seatIds = passengers.map((p) => p.seatId);
    if (new Set(seatIds).size !== seatIds.length) throw new HttpError(422, 'DUPLICATE_SEAT', 'The same seat was selected twice');
    const seats = (await c.query('SELECT id, class FROM seats WHERE train_id = $1 AND id = ANY($2)', [run.train_id, seatIds])).rows;
    if (seats.length !== seatIds.length) throw new HttpError(422, 'INVALID_SEAT', 'One or more seats do not belong to this train');
    const classes = new Map((await c.query('SELECT * FROM seat_classes')).rows.map((x) => [x.code, x]));
    const seatClass = new Map(seats.map((s) => [s.id, classes.get(s.class)]));

    // 4. Anti-hoarding: limited number of live holds per user.
    await expireHolds(c, runId);
    const live = (await c.query(
      `SELECT count(*)::int AS n FROM bookings WHERE user_id = $1 AND status = 'PENDING' AND hold_expires_at > now()`, [user.id])).rows[0].n;
    if (live >= config.maxActiveHoldsPerUser) {
      throw new HttpError(429, 'TOO_MANY_HOLDS', `You already have ${live} bookings waiting for payment. Finish or release one first.`);
    }

    // 5. Price on the server
    const fares = passengers.map((p) => fareFor(seatClass.get(p.seatId), j.distanceKm));
    const amount = fares.reduce((a, b) => a + b, 0);

    const booking = (await c.query(
      `INSERT INTO bookings (pnr, user_id, run_id, from_seq, to_seq, status, seat_count, amount_paise, hold_expires_at)
       VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7, now() + make_interval(secs => $8)) RETURNING id`,
      [newPnr(), user.id, runId, j.from.seq, j.to.seq, passengers.length, amount, config.holdSeconds])).rows[0];

    for (let i = 0; i < passengers.length; i++) {
      const p = passengers[i];
      await c.query(
        `INSERT INTO booking_passengers (booking_id, seat_id, name, age, gender, fare_paise) VALUES ($1,$2,$3,$4,$5,$6)`,
        [booking.id, p.seatId, p.name, p.age, p.gender, fares[i]]);
    }

    // 6. THE ATOMIC STEP. One row per seat per hop, inserted in a fixed order (seat, hop) so concurrent
    //    transactions can't deadlock. If any other booking already owns any of these (run, seat, hop) the
    //    primary key rejects the insert -> whole transaction rolls back -> nothing is held.
    try {
      await c.query(
        `INSERT INTO seat_segments (run_id, seat_id, seg_idx, booking_id)
         SELECT $1, s, g, $2 FROM unnest($3::bigint[]) AS s CROSS JOIN generate_series($4::int, $5::int) AS g
         ORDER BY s, g`,
        [runId, booking.id, seatIds, j.from.seq, j.to.seq - 1]);
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'SEAT_UNAVAILABLE', 'Sorry, one of those seats was just taken. Please pick another.');
      throw e;
    }
    await audit(c, user.id, 'BOOKING_HELD', 'booking', booking.id, { runId, seats: seatIds }, ip);
    return booking.id;
  });
  return getBookingView(id, user.id);
}

/* ------------------------------------------------------------------ PAY */
export async function pay(user, bookingId, idempotencyKey, payment, ip) {
  const outcome = await withTx(async (c) => {
    // Row lock: concurrent pay calls on the same booking (double click, two tabs) run one after another.
    const b = (await c.query(
      `SELECT *, hold_expires_at <= now() AS hold_over FROM bookings WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [bookingId, user.id])).rows[0];
    if (!b) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');

    // Idempotent replay: same key => same answer, no second charge
    const prev = (await c.query('SELECT * FROM payments WHERE booking_id = $1 AND idempotency_key = $2', [bookingId, idempotencyKey])).rows[0];
    if (prev) return { replayed: true, payment: prev };

    if (b.status === 'CONFIRMED') throw new HttpError(409, 'ALREADY_PAID', 'This booking is already paid and confirmed');
    if (b.status !== 'PENDING') throw new HttpError(409, 'NOT_PAYABLE', `This booking is ${b.status.toLowerCase()} and can no longer be paid`);

    if (b.hold_over) {
      // The hold ran out: free the seats NOW and refuse the payment. (Commit this release, then report the error.)
      await c.query(`UPDATE bookings SET status='EXPIRED', cancelled_at=now(), cancelled_by='SYSTEM', cancel_reason='HOLD_EXPIRED' WHERE id=$1`, [bookingId]);
      await c.query('DELETE FROM seat_segments WHERE booking_id = $1', [bookingId]);
      return { expired: true };
    }

    const charge = payment.method === 'CARD' ? chargeCard(payment.card) : chargeUpi(payment.upi);
    const attempts = b.payment_attempts + 1;
    const p = (await c.query(
      `INSERT INTO payments (booking_id, idempotency_key, amount_paise, method, instrument_hint, status, failure_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [bookingId, idempotencyKey, b.amount_paise, payment.method, charge.hint, charge.ok ? 'SUCCESS' : 'FAILED', charge.ok ? null : charge.code])).rows[0];

    if (charge.ok) {
      await c.query(
        `UPDATE bookings SET status='CONFIRMED', paid_amount_paise=amount_paise, confirmed_at=now(), payment_attempts=$2 WHERE id=$1`,
        [bookingId, attempts]);
      await audit(c, user.id, 'PAYMENT_SUCCESS', 'booking', bookingId, { amount: b.amount_paise }, ip);
    } else if (attempts >= config.maxPaymentAttempts) {
      await c.query(
        `UPDATE bookings SET status='FAILED', payment_attempts=$2, cancelled_at=now(), cancelled_by='SYSTEM', cancel_reason='PAYMENT_FAILED' WHERE id=$1`,
        [bookingId, attempts]);
      await c.query('DELETE FROM seat_segments WHERE booking_id = $1', [bookingId]);
      await audit(c, user.id, 'PAYMENT_FAILED_FINAL', 'booking', bookingId, { code: charge.code }, ip);
    } else {
      await c.query('UPDATE bookings SET payment_attempts=$2 WHERE id=$1', [bookingId, attempts]);
      await audit(c, user.id, 'PAYMENT_FAILED', 'booking', bookingId, { code: charge.code, attempts }, ip);
    }
    return { payment: p, replayed: false };
  });

  if (outcome.expired) throw new HttpError(410, 'HOLD_EXPIRED', 'Your seat hold expired before payment. No money was taken. Please select seats again.');
  const booking = await getBookingView(bookingId, user.id);
  const p = outcome.payment;
  return {
    booking,
    payment: {
      status: p.status, method: p.method, instrument: p.instrument_hint,
      failureCode: p.failure_code, failureMessage: p.failure_code ? FAILURES[p.failure_code] : null,
      attemptsLeft: booking.status === 'PENDING' ? Math.max(0, config.maxPaymentAttempts - booking.paymentAttempts) : 0,
    },
    replayed: outcome.replayed,
  };
}

/* ------------------------------------------------------------------ RELEASE (user abandons checkout) */
export async function release(user, bookingId, ip) {
  await withTx(async (c) => {
    const b = (await c.query('SELECT id, status FROM bookings WHERE id=$1 AND user_id=$2 FOR UPDATE', [bookingId, user.id])).rows[0];
    if (!b) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    if (b.status === 'CONFIRMED') throw new HttpError(409, 'ALREADY_PAID', 'A paid booking must be cancelled, not released');
    if (b.status !== 'PENDING') return; // already released / expired: idempotent
    await c.query(`UPDATE bookings SET status='EXPIRED', cancelled_at=now(), cancelled_by='USER', cancel_reason='RELEASED_BY_USER' WHERE id=$1`, [bookingId]);
    await c.query('DELETE FROM seat_segments WHERE booking_id = $1', [bookingId]);
    await audit(c, user.id, 'HOLD_RELEASED', 'booking', bookingId, null, ip);
  });
  return getBookingView(bookingId, user.id);
}

/* ------------------------------------------------------------------ CANCEL (paid booking) */
export async function cancel(user, bookingId, ip) {
  await withTx(async (c) => {
    const b = (await c.query(
      `SELECT b.id, b.status, b.paid_amount_paise,
              EXTRACT(EPOCH FROM ((r.start_at + make_interval(mins => ts.depart_offset_min)) - now())) AS secs
         FROM bookings b
         JOIN train_runs r  ON r.id = b.run_id
         JOIN train_stops ts ON ts.train_id = r.train_id AND ts.seq = b.from_seq
        WHERE b.id = $1 AND b.user_id = $2 FOR UPDATE OF b`, [bookingId, user.id])).rows[0];
    if (!b) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    if (b.status === 'CANCELLED') throw new HttpError(409, 'ALREADY_CANCELLED', 'This booking is already cancelled');
    if (b.status !== 'CONFIRMED') throw new HttpError(409, 'NOT_CANCELLABLE', 'Only confirmed bookings can be cancelled');
    const secs = Number(b.secs);
    if (secs <= 0) throw new HttpError(409, 'ALREADY_DEPARTED', 'The train has already departed; this ticket can no longer be cancelled');
    const refund = refundAmount(b.paid_amount_paise, secs);
    await c.query(
      `UPDATE bookings SET status='CANCELLED', refund_amount_paise=$2, cancelled_at=now(), cancelled_by='USER', cancel_reason='USER_CANCELLED' WHERE id=$1`,
      [bookingId, refund]);
    await c.query('DELETE FROM seat_segments WHERE booking_id = $1', [bookingId]);   // seats go back on sale instantly
    await audit(c, user.id, 'BOOKING_CANCELLED', 'booking', bookingId, { refund, percent: refundPercent(secs) }, ip);
  });
  return getBookingView(bookingId, user.id);
}

/* ------------------------------------------------------------------ READ */
const VIEW_SQL = `
  SELECT b.*, r.start_at, r.status AS run_status, t.number AS train_number, t.name AS train_name, r.train_id,
         fs.code AS from_code, fs.name AS from_name, tsn.code AS to_code, tsn.name AS to_name,
         r.start_at + make_interval(mins => f.depart_offset_min)  AS departs_at,
         r.start_at + make_interval(mins => tt.arrive_offset_min) AS arrives_at,
         EXTRACT(EPOCH FROM (r.start_at + make_interval(mins => f.depart_offset_min) - now())) AS secs_to_departure,
         GREATEST(0, EXTRACT(EPOCH FROM (b.hold_expires_at - now()))) AS hold_secs_left
    FROM bookings b
    JOIN train_runs r   ON r.id = b.run_id
    JOIN trains t       ON t.id = r.train_id
    JOIN train_stops f  ON f.train_id = r.train_id AND f.seq = b.from_seq
    JOIN stations fs    ON fs.id = f.station_id
    JOIN train_stops tt ON tt.train_id = r.train_id AND tt.seq = b.to_seq
    JOIN stations tsn   ON tsn.id = tt.station_id`;

function shape(b, passengers) {
  const secs = Number(b.secs_to_departure);
  const canCancel = b.status === 'CONFIRMED' && secs > 0;
  const holdLeft = b.status === 'PENDING' ? Math.floor(Number(b.hold_secs_left)) : 0;
  return {
    id: b.id, pnr: b.pnr, status: b.status === 'PENDING' && holdLeft === 0 ? 'EXPIRED' : b.status,
    train: { number: b.train_number, name: b.train_name },
    runId: b.run_id, runStatus: b.run_status,
    from: { code: b.from_code, name: b.from_name }, to: { code: b.to_code, name: b.to_name },
    departsAt: b.departs_at, arrivesAt: b.arrives_at,
    seatCount: b.seat_count, amountPaise: b.amount_paise,
    paidPaise: b.paid_amount_paise, refundPaise: b.refund_amount_paise,
    holdSecondsLeft: holdLeft, paymentAttempts: b.payment_attempts,
    maxPaymentAttempts: config.maxPaymentAttempts,
    canCancel,
    refundIfCancelled: canCancel ? { percent: refundPercent(secs), amountPaise: refundAmount(b.paid_amount_paise, secs) } : null,
    confirmedAt: b.confirmed_at, cancelledAt: b.cancelled_at, cancelledBy: b.cancelled_by, cancelReason: b.cancel_reason,
    createdAt: b.created_at,
    passengers: passengers.map((p) => ({ name: p.name, age: p.age, gender: p.gender, coach: p.coach, seat: p.seat_no, class: p.class, farePaise: p.fare_paise })),
  };
}

const PASSENGERS_SQL = `
  SELECT bp.booking_id, bp.name, bp.age, bp.gender, bp.fare_paise, s.coach, s.seat_no, s.class
    FROM booking_passengers bp JOIN seats s ON s.id = bp.seat_id
   WHERE bp.booking_id = ANY($1) ORDER BY bp.booking_id, s.coach, s.row_no, s.col_no`;

/** Ownership is part of the query itself: someone else's booking is indistinguishable from a missing one (404). */
export async function getBookingView(bookingId, userId) {
  const b = (await query(`${VIEW_SQL} WHERE b.id = $1 AND b.user_id = $2`, [bookingId, userId])).rows[0];
  if (!b) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  const ps = (await query(PASSENGERS_SQL, [[bookingId]])).rows;
  return shape(b, ps);
}

export async function listBookings(userId) {
  const rows = (await query(`${VIEW_SQL} WHERE b.user_id = $1 AND NOT (b.status = 'PENDING' AND b.hold_expires_at <= now())
                             AND b.status NOT IN ('EXPIRED','FAILED') ORDER BY departs_at DESC LIMIT 200`, [userId])).rows;
  if (rows.length === 0) return [];
  const ps = (await query(PASSENGERS_SQL, [rows.map((r) => r.id)])).rows;
  return rows.map((b) => shape(b, ps.filter((p) => p.booking_id === b.id)));
}
