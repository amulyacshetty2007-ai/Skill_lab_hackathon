import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, mkUser, client, makeTrain, hold, J, FARE, key, OK_CARD, DECLINED_CARD, query } from './helpers.js';

let ctx;
before(async () => { ctx = await setup(); });
after(() => teardown(ctx));

test('9/10 organiser dashboard numbers match hand-computed expectations exactly', async () => {
  const T = await makeTrain(ctx.base, { runs: 2, coaches: [{ code: 'C1', class: 'CC' }] });   // 40 seats, 2 hops
  const [run1, run2] = T.runs;
  const S = T.seats;
  const u = await Promise.all(Array.from({ length: 6 }, () => mkUser()));
  const A = u.map((x) => client(ctx.base, x));
  const pay = (i, id, card = OK_CARD) => A[i]('POST', `/api/bookings/${id}/pay`, card, { 'idempotency-key': key() });

  // b1: 2 seats A->C paid, stays confirmed
  const b1 = (await hold(A[0], run1, J.AC, [S[0], S[1]])).body.booking; await pay(0, b1.id);
  // b2: 1 seat A->B paid, stays confirmed
  const b2 = (await hold(A[1], run1, J.AB, [S[2]])).body.booking; await pay(1, b2.id);
  // b3: 1 seat B->C paid then cancelled by the user 10 days out (90% refund)
  const b3 = (await hold(A[2], run1, J.BC, [S[3]])).body.booking; await pay(2, b3.id);
  await query(`UPDATE train_runs SET start_at = now() + interval '60 hours' WHERE id=$1`, [run1]);
  await A[2]('POST', `/api/bookings/${b3.id}/cancel`);
  // b4: a live hold (not paid)
  await hold(A[3], run1, J.AC, [S[4]]);
  // b5: three failed payments -> FAILED (must not count anywhere in money)
  const b5 = (await hold(A[4], run1, J.AC, [S[5]])).body.booking;
  for (let i = 0; i < 3; i++) await pay(4, b5.id, DECLINED_CARD);
  // b6: paid on run2, then the organiser cancels run2 -> 100% refund
  const b6 = (await hold(A[5], run2, J.AC, [S[6]])).body.booking; await pay(5, b6.id);
  await T.api('POST', `/api/organiser/runs/${run2}/cancel`, { reason: 'Signal failure' });

  const fare = FARE.CC;
  const gross = 2 * fare.AC + fare.AB + fare.BC + fare.AC;           // b1 + b2 + b3 + b6
  const refunds = Math.floor(fare.BC * 0.9) + fare.AC;               // b3 at 90% + b6 at 100%
  const d = (await T.api('GET', '/api/organiser/dashboard?days=7')).body;

  assert.deepEqual(d.kpis, {
    grossPaise: gross, refundsPaise: refunds, netPaise: gross - refunds,
    confirmedBookings: 2, cancelledBookings: 2, seatsSold: 3, activeHolds: 1, upcomingRuns: 1,
  });
  assert.equal(d.daily.length, 7);
  assert.equal(d.daily.reduce((a, x) => a + x.salesPaise, 0), gross, 'daily sales add up to gross');
  assert.equal(d.daily.reduce((a, x) => a + x.refundsPaise, 0), refunds, 'daily refunds add up to refunds');
  assert.equal(d.daily.reduce((a, x) => a + x.bookings, 0), 4);
  const st = Object.fromEntries(d.byStatus.map((s) => [s.status, s.n]));
  assert.deepEqual(st, { CANCELLED: 2, CONFIRMED: 2, FAILED: 1, PENDING: 1 });

  // Run-level: run1 occupancy = confirmed seat-hops / (40 seats x 2 hops) = (2 seats x2 hops + 1 seat x1 hop) / 80
  const r1 = d.runs.find((r) => r.id === run1);
  assert.equal(r1.seatsSold, 3);
  assert.equal(r1.confirmedBookings, 2);
  assert.equal(r1.occupancyPct, Math.round((5 / 80) * 1000) / 10);
  assert.equal(r1.grossPaise, 2 * fare.AC + fare.AB + fare.BC);
  assert.equal(r1.netPaise, 2 * fare.AC + fare.AB + fare.BC - Math.floor(fare.BC * 0.9));
  assert.equal(d.runs.find((r) => r.id === run2)?.status, 'CANCELLED');
  assert.equal(d.runs.find((r) => r.id === run2).seatsSold, 0);

  // Manifest lists only people with live confirmed tickets
  const m = (await T.api('GET', `/api/organiser/runs/${run1}/manifest`)).body;
  assert.equal(m.passengers.length, 3);
  assert.deepEqual(m.passengers.map((p) => p.seat).sort(), ['1A', '1B', '1C'].sort());

  // another organiser sees none of it
  const other = client(ctx.base, await mkUser('ORGANISER'));
  const od = (await other('GET', '/api/organiser/dashboard')).body;
  assert.equal(od.kpis.grossPaise, 0); assert.equal(od.kpis.confirmedBookings, 0); assert.equal(od.runs.length, 0);
});

test('9/10 cancelling a ticket makes the seat count as free again in occupancy', async () => {
  const T = await makeTrain(ctx.base, { runs: 1, coaches: [{ code: 'C1', class: 'EC' }] });  // 20 seats
  const run = T.runs[0];
  const api = client(ctx.base, await mkUser());
  const b = (await hold(api, run, J.AC, [T.seats[0], T.seats[1], T.seats[2], T.seats[3]])).body.booking;
  await api('POST', `/api/bookings/${b.id}/pay`, OK_CARD, { 'idempotency-key': key() });
  let d = (await T.api('GET', '/api/organiser/dashboard')).body;
  assert.equal(d.runs[0].occupancyPct, 20, '4 of 20 seats over the full route');
  await api('POST', `/api/bookings/${b.id}/cancel`);
  d = (await T.api('GET', '/api/organiser/dashboard')).body;
  assert.equal(d.runs[0].occupancyPct, 0);
  assert.equal(d.kpis.seatsSold, 0);
  assert.equal(d.kpis.netPaise, d.kpis.grossPaise - d.kpis.refundsPaise);
});
