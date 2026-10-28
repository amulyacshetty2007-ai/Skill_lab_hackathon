import { query } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError } from '../utils/httpError.js';
import { fareFor } from './pricing.js';

/** A seat segment counts as occupied if its booking is sold, or is a hold that has not expired yet. */
export const OCCUPIED_SQL = `(b.status = 'CONFIRMED' OR (b.status = 'PENDING' AND b.hold_expires_at > now()))`;

export async function loadStops(db, trainId) {
  const { rows } = await db.query(
    `SELECT ts.seq, ts.arrive_offset_min, ts.depart_offset_min, ts.distance_km, s.code, s.name, s.city
       FROM train_stops ts JOIN stations s ON s.id = ts.station_id
      WHERE ts.train_id = $1 ORDER BY ts.seq`, [trainId]);
  return rows;
}

export function resolveJourney(stops, fromCode, toCode) {
  const from = stops.find((s) => s.code === fromCode);
  const to = stops.find((s) => s.code === toCode);
  if (!from || !to) throw new HttpError(422, 'INVALID_JOURNEY', 'This train does not stop at both stations');
  if (from.seq >= to.seq) throw new HttpError(422, 'INVALID_JOURNEY', 'Destination must come after the boarding station on this train');
  return { from, to, distanceKm: to.distance_km - from.distance_km };
}

export async function searchTrains({ from, to, date }) {
  const { rows } = await query(
    `SELECT r.id AS run_id, t.id AS train_id, t.number, t.name,
            f.seq AS from_seq, tt.seq AS to_seq,
            fs.code AS from_code, fs.name AS from_name, ts.code AS to_code, ts.name AS to_name,
            r.start_at + make_interval(mins => f.depart_offset_min)  AS departs_at,
            r.start_at + make_interval(mins => tt.arrive_offset_min) AS arrives_at,
            (tt.distance_km - f.distance_km) AS distance_km
       FROM train_runs r
       JOIN trains t       ON t.id = r.train_id
       JOIN train_stops f  ON f.train_id = t.id
       JOIN stations fs    ON fs.id = f.station_id AND fs.code = $1
       JOIN train_stops tt ON tt.train_id = t.id AND tt.seq > f.seq
       JOIN stations ts    ON ts.id = tt.station_id AND ts.code = $2
      WHERE r.status = 'SCHEDULED'
        AND ((r.start_at + make_interval(mins => f.depart_offset_min)) AT TIME ZONE 'Asia/Kolkata')::date = $3::date
        AND r.start_at + make_interval(mins => f.depart_offset_min) > now() + make_interval(mins => $4)
      ORDER BY departs_at`,
    [from, to, date, config.bookingCutoffMinutes]);
  if (rows.length === 0) return [];

  const classes = (await query('SELECT * FROM seat_classes ORDER BY rate_paise_km')).rows;
  const { rows: avail } = await query(
    `SELECT x.run_id, s.class, count(*)::int AS total,
            count(*) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM seat_segments ss JOIN bookings b ON b.id = ss.booking_id
               WHERE ss.run_id = x.run_id AND ss.seat_id = s.id
                 AND ss.seg_idx BETWEEN x.from_seq AND x.to_seq - 1 AND ${OCCUPIED_SQL}))::int AS available
       FROM unnest($1::uuid[], $2::int[], $3::int[], $4::uuid[]) AS x(run_id, from_seq, to_seq, train_id)
       JOIN seats s ON s.train_id = x.train_id
      GROUP BY x.run_id, s.class`,
    [rows.map((r) => r.run_id), rows.map((r) => r.from_seq), rows.map((r) => r.to_seq), rows.map((r) => r.train_id)]);

  return rows.map((r) => ({
    runId: r.run_id, trainNumber: r.number, trainName: r.name,
    from: { code: r.from_code, name: r.from_name }, to: { code: r.to_code, name: r.to_name },
    departsAt: r.departs_at, arrivesAt: r.arrives_at, distanceKm: r.distance_km,
    durationMin: Math.round((new Date(r.arrives_at) - new Date(r.departs_at)) / 60000),
    classes: classes.flatMap((c) => {
      const a = avail.find((x) => x.run_id === r.run_id && x.class === c.code);
      return a ? [{ code: c.code, name: c.name, farePaise: fareFor(c, r.distance_km), available: a.available, total: a.total }] : [];
    }),
  }));
}

export async function seatMap({ runId, from, to, userId }) {
  const run = (await query(
    `SELECT r.id, r.status, r.start_at, t.id AS train_id, t.number, t.name
       FROM train_runs r JOIN trains t ON t.id = r.train_id WHERE r.id = $1`, [runId])).rows[0];
  if (!run) throw new HttpError(404, 'RUN_NOT_FOUND', 'Run not found');
  const stops = await loadStops({ query }, run.train_id);
  const j = resolveJourney(stops, from, to);

  const { rows: seats } = await query(
    `SELECT s.id, s.coach, s.seat_no, s.row_no, s.col_no, s.class, occ.status AS occ_status, occ.user_id AS occ_user
       FROM seats s
       LEFT JOIN LATERAL (
         SELECT b.status, b.user_id
           FROM seat_segments ss JOIN bookings b ON b.id = ss.booking_id
          WHERE ss.run_id = $1 AND ss.seat_id = s.id AND ss.seg_idx BETWEEN $2 AND $3 AND ${OCCUPIED_SQL}
          ORDER BY (b.status = 'CONFIRMED') DESC LIMIT 1) occ ON true
      WHERE s.train_id = $4
      ORDER BY s.coach, s.row_no, s.col_no`,
    [runId, j.from.seq, j.to.seq - 1, run.train_id]);
  const classes = new Map((await query('SELECT * FROM seat_classes')).rows.map((c) => [c.code, c]));

  const coaches = new Map();
  for (const s of seats) {
    if (!coaches.has(s.coach)) {
      const cls = classes.get(s.class);
      coaches.set(s.coach, {
        code: s.coach, class: cls.code, className: cls.name, cols: cls.cols, aisleAfter: cls.aisle_after,
        rows: cls.seat_rows, farePaise: fareFor(cls, j.distanceKm), seats: [],
      });
    }
    let state = 'AVAILABLE';
    if (s.occ_status) {
      if (userId && s.occ_user === userId) state = 'MINE';
      else state = s.occ_status === 'CONFIRMED' ? 'BOOKED' : 'HELD';
    }
    coaches.get(s.coach).seats.push({ id: s.id, no: s.seat_no, row: s.row_no, col: s.col_no, state });
  }
  return {
    runId: run.id, status: run.status, trainNumber: run.number, trainName: run.name,
    from: { code: j.from.code, name: j.from.name }, to: { code: j.to.code, name: j.to.name },
    departsAt: new Date(new Date(run.start_at).getTime() + j.from.depart_offset_min * 60000),
    arrivesAt: new Date(new Date(run.start_at).getTime() + j.to.arrive_offset_min * 60000),
    distanceKm: j.distanceKm, maxPassengers: config.maxPassengers, holdSeconds: config.holdSeconds,
    coaches: [...coaches.values()],
  };
}
