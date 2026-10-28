// Train + schedule creation, shared by the organiser API and the seed script.
import { HttpError } from '../utils/httpError.js';

/** Create a train with its route, coaches and generated seat grid. Runs inside the caller's transaction. */
export async function createTrain(client, organiserId, { number, name, stops, coaches }) {
  // Stations must exist and each can appear once
  const codes = stops.map((s) => s.stationCode);
  if (new Set(codes).size !== codes.length) throw new HttpError(422, 'INVALID_ROUTE', 'A station can appear only once on a route');
  const st = await client.query('SELECT id, code FROM stations WHERE code = ANY($1)', [codes]);
  const byCode = new Map(st.rows.map((r) => [r.code, r.id]));
  for (const c of codes) if (!byCode.has(c)) throw new HttpError(422, 'UNKNOWN_STATION', `Unknown station code ${c}`);

  // Route sanity: times and distances must move forward
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    if (s.departOffsetMin < s.arriveOffsetMin) throw new HttpError(422, 'INVALID_ROUTE', `Stop ${s.stationCode}: departure is before arrival`);
    if (i > 0) {
      const p = stops[i - 1];
      if (s.arriveOffsetMin <= p.departOffsetMin) throw new HttpError(422, 'INVALID_ROUTE', `Stop ${s.stationCode}: must arrive after the previous stop departs`);
      if (s.distanceKm <= p.distanceKm) throw new HttpError(422, 'INVALID_ROUTE', `Stop ${s.stationCode}: distance must increase along the route`);
    }
  }
  if (stops[0].arriveOffsetMin !== 0 || stops[0].departOffsetMin !== 0 || stops[0].distanceKm !== 0) {
    throw new HttpError(422, 'INVALID_ROUTE', 'The first stop must have offset 0 and distance 0');
  }

  let train;
  try {
    train = (await client.query(
      'INSERT INTO trains (organiser_id, number, name) VALUES ($1,$2,$3) RETURNING id, number, name',
      [organiserId, number, name])).rows[0];
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'TRAIN_EXISTS', `Train number ${number} already exists`);
    throw e;
  }

  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    await client.query(
      `INSERT INTO train_stops (train_id, seq, station_id, arrive_offset_min, depart_offset_min, distance_km)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [train.id, i, byCode.get(s.stationCode), s.arriveOffsetMin, s.departOffsetMin, s.distanceKm]);
  }

  const classes = (await client.query('SELECT * FROM seat_classes')).rows;
  const classMap = new Map(classes.map((c) => [c.code, c]));
  const coachCodes = new Set();
  for (const co of coaches) {
    if (coachCodes.has(co.code)) throw new HttpError(422, 'INVALID_COACHES', `Duplicate coach ${co.code}`);
    coachCodes.add(co.code);
    const cls = classMap.get(co.class);
    if (!cls) throw new HttpError(422, 'INVALID_COACHES', `Unknown class ${co.class}`);
    await client.query('INSERT INTO coaches (train_id, code, class) VALUES ($1,$2,$3)', [train.id, co.code, co.class]);
    const values = []; const params = [train.id, co.code, co.class];
    for (let r = 1; r <= cls.seat_rows; r++) {
      for (let c = 0; c < cls.cols.length; c++) {
        params.push(`${r}${cls.cols[c]}`, r, c);
        const n = params.length;
        values.push(`($1,$2,$${n - 2},$${n - 1},$${n},$3)`);
      }
    }
    await client.query(
      `INSERT INTO seats (train_id, coach, seat_no, row_no, col_no, class) VALUES ${values.join(',')}`, params);
  }
  return train;
}

/**
 * Create scheduled runs. startDate is YYYY-MM-DD, departTime HH:MM, both in IST (the railway's local time).
 * Idempotent thanks to UNIQUE (train_id, start_at).
 */
export async function scheduleRuns(client, trainId, { startDate, days, departTime }) {
  const res = await client.query(
    `INSERT INTO train_runs (train_id, start_at)
     SELECT $1, (($2::date + g) + $3::time) AT TIME ZONE 'Asia/Kolkata'
     FROM generate_series(0, $4::int - 1) g
     ON CONFLICT (train_id, start_at) DO NOTHING
     RETURNING id`,
    [trainId, startDate, departTime, days]);
  return res.rowCount;
}
