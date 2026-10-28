// Demo data: stations, 6 trains (3 routes x both directions), 2 organisers, 1 user, 30 days of runs.
import bcrypt from 'bcryptjs';
import { pool, withTx } from './pool.js';
import { config } from '../config.js';
import { createTrain, scheduleRuns } from '../services/trains.js';

const STATIONS = [
  ['MAS', 'Chennai Central', 'Chennai'],
  ['KPD', 'Katpadi Junction', 'Vellore'],
  ['SBC', 'KSR Bengaluru City', 'Bengaluru'],
  ['MYS', 'Mysuru Junction', 'Mysuru'],
  ['TK',  'Tumakuru', 'Tumakuru'],
  ['DVG', 'Davangere', 'Davangere'],
  ['UBL', 'Hubballi Junction', 'Hubballi'],
  ['MAQ', 'Mangaluru Central', 'Mangaluru'],
  ['HAS', 'Hassan Junction', 'Hassan'],
];

// [stationCode, arriveOffsetMin, departOffsetMin, distanceKm]
const ROUTES = [
  { key: 'A', fwd: ['20601', 'Chennai Express', '06:00'], rev: ['20602', 'Chennai Return Express', '15:30'],
    stops: [['MAS', 0, 0, 0], ['KPD', 105, 107, 126], ['SBC', 280, 285, 362], ['MYS', 400, 400, 495]],
    coaches: [['C1', 'CC'], ['C2', 'CC'], ['C3', 'CC'], ['E1', 'EC']] },
  { key: 'B', fwd: ['12027', 'Karnataka Shatabdi', '07:30'], rev: ['12028', 'Karnataka Shatabdi Return', '17:00'],
    stops: [['SBC', 0, 0, 0], ['TK', 70, 72, 70], ['DVG', 235, 238, 260], ['UBL', 360, 360, 410]],
    coaches: [['C1', 'CC'], ['C2', 'CC'], ['E1', 'EC']] },
  { key: 'C', fwd: ['16515', 'Malnad Intercity', '09:15'], rev: ['16516', 'Malnad Intercity Return', '19:45'],
    stops: [['SBC', 0, 0, 0], ['HAS', 190, 193, 195], ['MAQ', 420, 420, 350]],
    coaches: [['C1', 'CC'], ['C2', 'CC'], ['E1', 'EC']] },
];

function reverse(stops) {
  const T = stops[stops.length - 1][1];            // total journey time = arrival at the last stop
  const total = stops[stops.length - 1][3];        // total distance
  return [...stops].reverse().map(([code, arr, dep, dist]) => [code, T - dep, T - arr, total - dist]);
}

const toStop = ([stationCode, arriveOffsetMin, departOffsetMin, distanceKm]) =>
  ({ stationCode, arriveOffsetMin, departOffsetMin, distanceKm });

export async function seedIfEmpty() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM stations');
  if (rows[0].n > 0) return false;

  const pw = (p) => bcrypt.hash(p, config.bcryptCost);
  await withTx(async (c) => {
    for (const [code, name, city] of STATIONS) {
      await c.query('INSERT INTO stations (code, name, city) VALUES ($1,$2,$3)', [code, name, city]);
    }
    const org1 = (await c.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ('Southern Railways Ops','organiser@railrush.dev',$1,'ORGANISER') RETURNING id`,
      [await pw('Organiser@123')])).rows[0].id;
    await c.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ('Coastal Lines','organiser2@railrush.dev',$1,'ORGANISER')`,
      [await pw('Organiser@123')]);
    await c.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ('Asha Rao','user@railrush.dev',$1,'USER')`,
      [await pw('User@12345')]);

    for (const r of ROUTES) {
      const coaches = r.coaches.map(([code, cls]) => ({ code, class: cls }));
      const fwd = await createTrain(c, org1, { number: r.fwd[0], name: r.fwd[1], stops: r.stops.map(toStop), coaches });
      const rev = await createTrain(c, org1, { number: r.rev[0], name: r.rev[1], stops: reverse(r.stops).map(toStop), coaches });
      void fwd; void rev;
    }
  });
  await topUpRuns();
  return true;
}

/** Make sure every demo train has runs for the next 30 days. Safe to call repeatedly. */
export async function topUpRuns() {
  const times = new Map(ROUTES.flatMap((r) => [[r.fwd[0], r.fwd[2]], [r.rev[0], r.rev[2]]]));
  const { rows } = await pool.query('SELECT id, number FROM trains WHERE number = ANY($1)', [[...times.keys()]]);
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // today in IST
  await withTx(async (c) => {
    for (const t of rows) await scheduleRuns(c, t.id, { startDate: today, days: 30, departTime: times.get(t.number) });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedIfEmpty().then(async (did) => {
    console.log(did ? 'seeded demo data' : 'database already has data, topping up runs');
    await topUpRuns();
    await pool.end();
  }).catch((e) => { console.error(e); process.exit(1); });
}
