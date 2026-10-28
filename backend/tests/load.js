// Stress test: many users, many seats, random journeys, all at once. Run: npm run test:load
// It proves the database invariant under heavy contention and prints throughput.
import assert from 'node:assert/strict';
import { setup, teardown, mkUser, client, makeTrain, hold, J, key, OK_CARD, query } from './helpers.js';

const USERS = Number(process.env.LOAD_USERS || 150);
const ROUNDS = Number(process.env.LOAD_ROUNDS || 4);

const ctx = await setup();
try {
  const T = await makeTrain(ctx.base, { runs: 1, coaches: [{ code: 'C1', class: 'CC' }] });   // 40 seats x 2 hops = 80 slots
  const run = T.runs[0];
  const users = await Promise.all(Array.from({ length: USERS }, (_, i) => mkUser('USER', `Load ${i}`)));
  const journeys = [J.AC, J.AB, J.BC];
  const started = Date.now();
  let accepted = 0, rejected = 0, paid = 0, requests = 0;

  for (let round = 0; round < ROUNDS; round++) {
    const results = await Promise.all(users.map(async (u, i) => {
      const api = client(ctx.base, u);
      const seats = [T.seats[Math.floor(Math.random() * 40)]];
      if (Math.random() < 0.3) seats.push(T.seats[Math.floor(Math.random() * 40)]);
      const r = await hold(api, run, journeys[Math.floor(Math.random() * 3)], [...new Set(seats)]);
      requests++;
      assert.ok([201, 409, 429, 422].includes(r.status), `unexpected ${r.status} ${JSON.stringify(r.body)}`);
      if (r.status !== 201) { rejected++; return null; }
      accepted++;
      if (Math.random() < 0.7) {
        const p = await api('POST', `/api/bookings/${r.body.booking.id}/pay`, OK_CARD, { 'idempotency-key': key() });
        requests++;
        assert.equal(p.status, 200); paid++;
      } else {
        await api('POST', `/api/bookings/${r.body.booking.id}/release`); requests++;
      }
      return r.body.booking.id;
    }));
    void results;
  }

  // INVARIANTS
  const dup = await query('SELECT seat_id, seg_idx FROM seat_segments WHERE run_id=$1 GROUP BY 1,2 HAVING count(*)>1', [run]);
  assert.equal(dup.rowCount, 0, 'a seat-hop was sold twice');
  const orphan = await query(`SELECT count(*)::int n FROM seat_segments ss JOIN bookings b ON b.id=ss.booking_id WHERE ss.run_id=$1 AND b.status NOT IN ('PENDING','CONFIRMED')`, [run]);
  assert.equal(orphan.rows[0].n, 0, 'segments leaked from a dead booking');
  const sold = (await query(`SELECT count(*)::int n FROM seat_segments WHERE run_id=$1`, [run])).rows[0].n;
  assert.ok(sold <= 80, 'more seat-hops sold than exist');
  // each confirmed booking owns exactly its hops
  const bad = await query(`SELECT b.id FROM bookings b LEFT JOIN seat_segments ss ON ss.booking_id=b.id
                           WHERE b.run_id=$1 AND b.status='CONFIRMED' GROUP BY b.id, b.seat_count, b.from_seq, b.to_seq
                           HAVING count(ss.*) <> b.seat_count*(b.to_seq-b.from_seq)`, [run]);
  assert.equal(bad.rowCount, 0, 'a confirmed booking is missing seat-hops');

  const secs = (Date.now() - started) / 1000;
  console.log(`\nLOAD TEST PASSED  users=${USERS} rounds=${ROUNDS} requests=${requests} in ${secs.toFixed(1)}s (${Math.round(requests / secs)} req/s)`);
  console.log(`accepted holds=${accepted} rejected=${rejected} paid=${paid}  seat-hops sold=${sold}/80  duplicates=0`);
} finally { await teardown(ctx); }
