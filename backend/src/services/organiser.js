import { query, withTx } from '../db/pool.js';
import { HttpError } from '../utils/httpError.js';

/**
 * Dashboard numbers. Every query is scoped by trains.organiser_id = $1, so an organiser can only ever see own data.
 *
 * Definitions (also in docs/BOOKING_RULES.md):
 *   gross revenue  = sum of paid_amount over bookings that were paid (CONFIRMED + later CANCELLED)
 *   refunds        = sum of refund_amount
 *   net revenue    = gross - refunds
 *   seats sold     = seats on currently CONFIRMED bookings
 *   occupancy      = confirmed seat-hops / (seats x hops) of a run  -> a seat sold only A->B counts only for that hop
 */
export async function dashboard(organiserId, days) {
  const kpi = (await query(
    `SELECT count(*) FILTER (WHERE b.status = 'CONFIRMED')::int                         AS confirmed_bookings,
            count(*) FILTER (WHERE b.status = 'CANCELLED')::int                         AS cancelled_bookings,
            COALESCE(sum(b.seat_count) FILTER (WHERE b.status = 'CONFIRMED'), 0)::int   AS seats_sold,
            COALESCE(sum(b.paid_amount_paise), 0)::bigint                               AS gross,
            COALESCE(sum(b.refund_amount_paise), 0)::bigint                             AS refunds,
            count(*) FILTER (WHERE b.status = 'PENDING' AND b.hold_expires_at > now())::int AS active_holds
       FROM bookings b JOIN train_runs r ON r.id = b.run_id JOIN trains t ON t.id = r.train_id
      WHERE t.organiser_id = $1`, [organiserId])).rows[0];

  const upcomingRuns = (await query(
    `SELECT count(*)::int AS n FROM train_runs r JOIN trains t ON t.id = r.train_id
      WHERE t.organiser_id = $1 AND r.status = 'SCHEDULED' AND r.start_at > now()`, [organiserId])).rows[0].n;

  const daily = (await query(
    `WITH d AS (SELECT generate_series(((now() AT TIME ZONE 'Asia/Kolkata')::date - ($2::int - 1)), (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day')::date AS day),
          sales AS (SELECT (b.confirmed_at AT TIME ZONE 'Asia/Kolkata')::date AS day, sum(b.paid_amount_paise) AS amt, count(*) AS n
                      FROM bookings b JOIN train_runs r ON r.id = b.run_id JOIN trains t ON t.id = r.train_id
                     WHERE t.organiser_id = $1 AND b.paid_amount_paise IS NOT NULL GROUP BY 1),
          refunds AS (SELECT (b.cancelled_at AT TIME ZONE 'Asia/Kolkata')::date AS day, sum(b.refund_amount_paise) AS amt
                        FROM bookings b JOIN train_runs r ON r.id = b.run_id JOIN trains t ON t.id = r.train_id
                       WHERE t.organiser_id = $1 AND b.refund_amount_paise > 0 GROUP BY 1)
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(sales.amt, 0)::bigint AS sales, COALESCE(refunds.amt, 0)::bigint AS refunds,
            COALESCE(sales.n, 0)::int AS bookings
       FROM d LEFT JOIN sales ON sales.day = d.day LEFT JOIN refunds ON refunds.day = d.day ORDER BY d.day`, [organiserId, days])).rows;

  const runs = await listRuns(organiserId, { scope: 'upcoming', limit: 12 });

  const byStatus = (await query(
    `SELECT b.status, count(*)::int AS n FROM bookings b JOIN train_runs r ON r.id = b.run_id JOIN trains t ON t.id = r.train_id
      WHERE t.organiser_id = $1 AND NOT (b.status = 'PENDING' AND b.hold_expires_at <= now())
      GROUP BY b.status ORDER BY b.status`, [organiserId])).rows;

  const recent = (await query(
    `SELECT b.pnr, b.status, b.seat_count, b.amount_paise, b.refund_amount_paise, b.created_at, t.number AS train_number,
            fs.code AS from_code, ts.code AS to_code
       FROM bookings b JOIN train_runs r ON r.id = b.run_id JOIN trains t ON t.id = r.train_id
       JOIN train_stops f ON f.train_id = t.id AND f.seq = b.from_seq JOIN stations fs ON fs.id = f.station_id
       JOIN train_stops x ON x.train_id = t.id AND x.seq = b.to_seq   JOIN stations ts ON ts.id = x.station_id
      WHERE t.organiser_id = $1 AND b.status IN ('CONFIRMED', 'CANCELLED')
      ORDER BY COALESCE(b.cancelled_at, b.confirmed_at) DESC LIMIT 8`, [organiserId])).rows;

  const gross = Number(kpi.gross); const refunds = Number(kpi.refunds);
  return {
    kpis: {
      grossPaise: gross, refundsPaise: refunds, netPaise: gross - refunds,
      confirmedBookings: kpi.confirmed_bookings, cancelledBookings: kpi.cancelled_bookings,
      seatsSold: kpi.seats_sold, activeHolds: kpi.active_holds, upcomingRuns,
    },
    daily: daily.map((d) => ({ day: d.day, salesPaise: Number(d.sales), refundsPaise: Number(d.refunds), bookings: d.bookings })),
    byStatus, runs,
    recent: recent.map((r) => ({
      pnr: r.pnr, status: r.status, trainNumber: r.train_number, from: r.from_code, to: r.to_code,
      seats: r.seat_count, amountPaise: r.amount_paise, refundPaise: r.refund_amount_paise, at: r.created_at,
    })),
  };
}

export async function listRuns(organiserId, { scope = 'upcoming', limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT r.id, r.start_at, r.status, t.id AS train_id, t.number, t.name,
            o.name AS origin_name, o.code AS origin_code, d.code AS dest_code, d.name AS dest_name,
            cap.seats::int AS seat_capacity, cap.hops::int AS hops,
            COALESCE(c.bookings, 0)::int AS confirmed_bookings, COALESCE(c.seats, 0)::int AS seats_sold,
            COALESCE(c.gross, 0)::bigint AS gross, COALESCE(c.refunds, 0)::bigint AS refunds,
            COALESCE(seg.n, 0)::int AS confirmed_hops
       FROM train_runs r
       JOIN trains t ON t.id = r.train_id
       JOIN train_stops fs ON fs.train_id = t.id AND fs.seq = 0
       JOIN stations o ON o.id = fs.station_id
       JOIN train_stops ls ON ls.train_id = t.id AND ls.seq = (SELECT max(seq) FROM train_stops WHERE train_id = t.id)
       JOIN stations d ON d.id = ls.station_id
       CROSS JOIN LATERAL (SELECT (SELECT count(*) FROM seats WHERE train_id = t.id) AS seats,
                                  (SELECT count(*) - 1 FROM train_stops WHERE train_id = t.id) AS hops) cap
       LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE status = 'CONFIRMED') AS bookings,
                                 sum(seat_count) FILTER (WHERE status = 'CONFIRMED') AS seats,
                                 sum(paid_amount_paise) AS gross, sum(refund_amount_paise) AS refunds
                            FROM bookings WHERE run_id = r.id AND paid_amount_paise IS NOT NULL) c ON true
       LEFT JOIN LATERAL (SELECT count(*) AS n FROM seat_segments ss JOIN bookings b ON b.id = ss.booking_id
                           WHERE ss.run_id = r.id AND b.status = 'CONFIRMED') seg ON true
      WHERE t.organiser_id = $1 AND (($2 = 'upcoming' AND r.start_at > now()) OR ($2 = 'past' AND r.start_at <= now()))
      ORDER BY CASE WHEN $2 = 'upcoming' THEN r.start_at END ASC, CASE WHEN $2 = 'past' THEN r.start_at END DESC
      LIMIT $3`, [organiserId, scope, limit]);
  return rows.map((r) => ({
    id: r.id, startAt: r.start_at, status: r.status, trainNumber: r.number, trainName: r.name,
    origin: { code: r.origin_code, name: r.origin_name }, destination: { code: r.dest_code, name: r.dest_name },
    seatCapacity: r.seat_capacity, seatsSold: r.seats_sold, confirmedBookings: r.confirmed_bookings,
    occupancyPct: r.seat_capacity * r.hops === 0 ? 0 : Math.round((r.confirmed_hops / (r.seat_capacity * r.hops)) * 1000) / 10,
    grossPaise: Number(r.gross), refundsPaise: Number(r.refunds), netPaise: Number(r.gross) - Number(r.refunds),
  }));
}

export async function listTrains(organiserId) {
  const trains = (await query(
    `SELECT t.id, t.number, t.name,
            (SELECT count(*)::int FROM seats WHERE train_id = t.id) AS seats,
            (SELECT count(*)::int FROM train_runs WHERE train_id = t.id AND status='SCHEDULED' AND start_at > now()) AS upcoming_runs
       FROM trains t WHERE t.organiser_id = $1 ORDER BY t.number`, [organiserId])).rows;
  if (trains.length === 0) return [];
  const ids = trains.map((t) => t.id);
  const stops = (await query(
    `SELECT ts.train_id, ts.seq, ts.depart_offset_min, ts.arrive_offset_min, ts.distance_km, s.code, s.name
       FROM train_stops ts JOIN stations s ON s.id = ts.station_id WHERE ts.train_id = ANY($1) ORDER BY ts.train_id, ts.seq`, [ids])).rows;
  const coaches = (await query('SELECT train_id, code, class FROM coaches WHERE train_id = ANY($1) ORDER BY code', [ids])).rows;
  return trains.map((t) => ({
    id: t.id, number: t.number, name: t.name, seats: t.seats, upcomingRuns: t.upcoming_runs,
    stops: stops.filter((s) => s.train_id === t.id).map((s) => ({ seq: s.seq, code: s.code, name: s.name, arriveOffsetMin: s.arrive_offset_min, departOffsetMin: s.depart_offset_min, distanceKm: s.distance_km })),
    coaches: coaches.filter((c) => c.train_id === t.id).map((c) => ({ code: c.code, class: c.class })),
  }));
}

export async function ownedTrain(organiserId, trainId, db = { query }) {
  const t = (await db.query('SELECT id FROM trains WHERE id = $1 AND organiser_id = $2', [trainId, organiserId])).rows[0];
  if (!t) throw new HttpError(404, 'TRAIN_NOT_FOUND', 'Train not found');   // 404 not 403: don't reveal other organisers' ids
  return t;
}

export async function manifest(organiserId, runId) {
  const run = (await query(
    `SELECT r.id, r.start_at, r.status, t.number, t.name FROM train_runs r JOIN trains t ON t.id = r.train_id
      WHERE r.id = $1 AND t.organiser_id = $2`, [runId, organiserId])).rows[0];
  if (!run) throw new HttpError(404, 'RUN_NOT_FOUND', 'Run not found');
  const { rows } = await query(
    `SELECT b.pnr, bp.name, bp.age, bp.gender, s.coach, s.seat_no, fs.code AS from_code, ts.code AS to_code
       FROM bookings b
       JOIN booking_passengers bp ON bp.booking_id = b.id JOIN seats s ON s.id = bp.seat_id
       JOIN train_runs r ON r.id = b.run_id
       JOIN train_stops f ON f.train_id = r.train_id AND f.seq = b.from_seq JOIN stations fs ON fs.id = f.station_id
       JOIN train_stops x ON x.train_id = r.train_id AND x.seq = b.to_seq   JOIN stations ts ON ts.id = x.station_id
      WHERE b.run_id = $1 AND b.status = 'CONFIRMED' ORDER BY s.coach, s.row_no, s.col_no, b.from_seq`, [runId]);
  return {
    run: { id: run.id, startAt: run.start_at, status: run.status, trainNumber: run.number, trainName: run.name },
    passengers: rows.map((r) => ({ pnr: r.pnr, name: r.name, age: r.age, gender: r.gender, coach: r.coach, seat: r.seat_no, from: r.from_code, to: r.to_code })),
  };
}

/** Organiser cancels a whole run: holds are released, every paid booking is refunded 100%. */
export async function cancelRun(organiserId, runId, reason, ip) {
  return withTx(async (c) => {
    // Lock order everywhere: run -> bookings. Booking holds take the run FOR SHARE, so they can't slip in after this.
    const run = (await c.query(
      `SELECT r.id, r.status, r.start_at FROM train_runs r JOIN trains t ON t.id = r.train_id
        WHERE r.id = $1 AND t.organiser_id = $2 FOR UPDATE OF r`, [runId, organiserId])).rows[0];
    if (!run) throw new HttpError(404, 'RUN_NOT_FOUND', 'Run not found');
    if (run.status === 'CANCELLED') throw new HttpError(409, 'ALREADY_CANCELLED', 'This run is already cancelled');
    if (new Date(run.start_at) <= new Date()) throw new HttpError(409, 'ALREADY_DEPARTED', 'This run has already departed');

    await c.query(`SELECT id FROM bookings WHERE run_id = $1 AND status IN ('PENDING','CONFIRMED') ORDER BY id FOR UPDATE`, [runId]);
    const expired = await c.query(
      `UPDATE bookings SET status='EXPIRED', cancelled_at=now(), cancelled_by='ORGANISER', cancel_reason='RUN_CANCELLED'
        WHERE run_id = $1 AND status = 'PENDING'`, [runId]);
    const refunded = await c.query(
      `UPDATE bookings SET status='CANCELLED', refund_amount_paise = paid_amount_paise, cancelled_at=now(), cancelled_by='ORGANISER', cancel_reason='RUN_CANCELLED'
        WHERE run_id = $1 AND status = 'CONFIRMED' RETURNING paid_amount_paise`, [runId]);
    await c.query('DELETE FROM seat_segments WHERE run_id = $1', [runId]);
    await c.query(`UPDATE train_runs SET status='CANCELLED', cancel_reason=$2 WHERE id=$1`, [runId, reason]);
    const total = refunded.rows.reduce((a, r) => a + r.paid_amount_paise, 0);
    await c.query('INSERT INTO audit_log (user_id, action, entity, entity_id, meta, ip) VALUES ($1,$2,$3,$4,$5,$6)',
      [organiserId, 'RUN_CANCELLED', 'run', runId, JSON.stringify({ reason, refunded: refunded.rowCount, total }), ip || null]);
    return { releasedHolds: expired.rowCount, refundedBookings: refunded.rowCount, refundedPaise: total };
  });
}
