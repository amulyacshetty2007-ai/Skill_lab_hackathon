// Shared test helpers. Tests run against a REAL PostgreSQL (that is the point: the guarantees live in the database).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!process.env.DATABASE_URL || !/test/i.test(new URL(process.env.DATABASE_URL).pathname)) {
  throw new Error('Refusing to run: set TEST_DATABASE_URL to a database whose name contains "test" (tests create and delete data).');
}
process.env.HOLD_SECONDS = process.env.HOLD_SECONDS || '300';

const { createApp } = await import('../src/app.js');
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { seedIfEmpty } = await import('../src/db/seed.js');
const { signSession } = await import('../src/middleware/auth.js');
const { config } = await import('../src/config.js');
const bcrypt = (await import('bcryptjs')).default;

export { pool, query, config, signSession };

export async function setup(overrides = {}) {
  await migrate();
  await seedIfEmpty();
  const app = createApp({ rateLimits: { global: 100000, auth: 100000, pay: 100000, hold: 100000 }, ...overrides });
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: async () => { await new Promise((r) => server.close(r)); } };
}
export const teardown = async (ctx) => { await ctx?.close(); await pool.end(); };

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const HASH = bcrypt.hashSync('Passw0rd!x', 4);

export async function mkUser(role = 'USER', name = 'Test Person') {
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role, token_version`,
    [name, `t-${uniq()}@test.dev`, HASH, role]);
  return { ...rows[0], token: signSession(rows[0]) };
}

/** Tiny HTTP client that behaves like a browser holding the session cookie. */
export function client(base, user = null, extraHeaders = {}) {
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(user ? { cookie: `rr_session=${user.token}` } : {}),
        ...extraHeaders, ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null; const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  };
}

export const key = () => `idem-${uniq()}-${Math.random().toString(36).slice(2)}`;
export const OK_CARD = { method: 'CARD', card: { number: '4242 4242 4242 4242', expiry: '12/39', cvv: '123' } };
export const DECLINED_CARD = { method: 'CARD', card: { number: '4000 0000 0000 0002', expiry: '12/39', cvv: '123' } };
export const pax = (seatId, name = 'Test Person') => ({ seatId, name, age: 30, gender: 'O' });

/**
 * Creates a dedicated organiser + train (3 stops A-B-C, one 40-seat Chair Car and one 20-seat Executive coach)
 * with `runs` scheduled runs, so each test file works on isolated data.
 */
export async function makeTrain(base, { runs = 6, coaches = [{ code: 'C1', class: 'CC' }, { code: 'E1', class: 'EC' }] } = {}) {
  const organiser = await mkUser('ORGANISER', 'Test Organiser');
  const api = client(base, organiser);
  const number = `T${Math.floor(Math.random() * 900000 + 100000)}`;
  const created = await api('POST', '/api/organiser/trains', {
    number, name: 'Test Express',
    stops: [
      { stationCode: 'SBC', arriveOffsetMin: 0, departOffsetMin: 0, distanceKm: 0 },
      { stationCode: 'TK', arriveOffsetMin: 60, departOffsetMin: 62, distanceKm: 100 },
      { stationCode: 'DVG', arriveOffsetMin: 200, departOffsetMin: 200, distanceKm: 250 },
    ], coaches,
  });
  if (created.status !== 201) throw new Error('makeTrain failed: ' + JSON.stringify(created.body));
  const trainId = created.body.train.id;
  const start = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const sched = await api('POST', `/api/organiser/trains/${trainId}/runs`, { startDate: start, days: runs, departTime: '08:00' });
  if (sched.status !== 201) throw new Error('schedule failed: ' + JSON.stringify(sched.body));
  const runRows = (await query('SELECT id FROM train_runs WHERE train_id = $1 ORDER BY start_at', [trainId])).rows.map((r) => r.id);
  const seatRows = (await query('SELECT id, coach, class FROM seats WHERE train_id = $1 ORDER BY coach, row_no, col_no', [trainId])).rows;
  return { organiser, api, trainId, number, runs: runRows, seats: seatRows.map((s) => s.id), seatRows };
}

// Journeys on the test train: stops SBC(0) TK(1) DVG(2) -> hops 0 and 1. Fares: CC 110p/km + 3000 fee.
export const J = {
  AC: { from: 'SBC', to: 'DVG' },  // hops 0,1  distance 250
  AB: { from: 'SBC', to: 'TK' },   // hop 0     distance 100
  BC: { from: 'TK', to: 'DVG' },   // hop 1     distance 150
};
export const FARE = { CC: { AC: 110 * 250 + 3000, AB: 110 * 100 + 3000, BC: 110 * 150 + 3000 } };

export const hold = (api, runId, journey, seatIds, names) =>
  api('POST', '/api/bookings/hold', { runId, ...journey, passengers: seatIds.map((s, i) => pax(s, names?.[i] || 'Test Person')) });
