import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, mkUser, client, makeTrain, hold, J, FARE, key, OK_CARD, DECLINED_CARD, query, pax } from './helpers.js';

let ctx, T;
before(async () => { ctx = await setup(); T = await makeTrain(ctx.base, { runs: 14 }); });
after(() => teardown(ctx));

const newUsers = (n) => Promise.all(Array.from({ length: n }, (_, i) => mkUser('USER', `Rider ${i}`)));
const segRows = (runId, seatId) => query('SELECT seg_idx, booking_id FROM seat_segments WHERE run_id=$1 AND seat_id=$2 ORDER BY seg_idx', [runId, seatId]);

test('5/10 same seat, 30 users at the same instant -> exactly ONE wins, no double sale', async () => {
  const run = T.runs[0], seat = T.seats[0];
  const users = await newUsers(30);
  const res = await Promise.all(users.map((u) => hold(client(ctx.base, u), run, J.AC, [seat])));
  const ok = res.filter((r) => r.status === 201);
  const lost = res.filter((r) => r.status === 409);
  assert.equal(ok.length, 1, 'exactly one hold may succeed');
  assert.equal(lost.length, 29, 'everyone else must get a clean 409');
  assert.ok(lost.every((r) => r.body.error.code === 'SEAT_UNAVAILABLE'));
  const rows = (await segRows(run, seat)).rows;
  assert.equal(rows.length, 2, 'seat owns exactly its two hops');
  assert.equal(new Set(rows.map((r) => r.booking_id)).size, 1, 'both hops belong to the one winner');
  // the losers left no trace
  const stray = await query(`SELECT count(*)::int n FROM bookings WHERE run_id=$1`, [run]);
  assert.equal(stray.rows[0].n, 1);
});

test('5/10 overlapping journeys on one seat: A-B and B-C coexist, A-C collides with either', async () => {
  const run = T.runs[1], seat = T.seats[3];
  const [u1, u2, u3, u4] = await newUsers(4);
  const r1 = await hold(client(ctx.base, u1), run, J.AB, [seat]);
  const r2 = await hold(client(ctx.base, u2), run, J.BC, [seat]);
  assert.equal(r1.status, 201); assert.equal(r2.status, 201, 'same seat, different hops must both succeed');
  const r3 = await hold(client(ctx.base, u3), run, J.AC, [seat]);
  assert.equal(r3.status, 409, 'A-C overlaps both');
  assert.equal((await segRows(run, seat)).rows.length, 2);
  // free A-B again -> A-B possible again, A-C still blocked by B-C
  await client(ctx.base, u1)('POST', `/api/bookings/${r1.body.booking.id}/release`);
  assert.equal((await hold(client(ctx.base, u4), run, J.AC, [seat])).status, 409);
  assert.equal((await hold(client(ctx.base, u4), run, J.AB, [seat])).status, 201);
});

test('5/10 racing overlapping journeys: whatever wins, accepted bookings never share a seat-hop', async () => {
  const run = T.runs[2];
  const seats = T.seats.slice(0, 6);
  const users = await newUsers(36);
  const journeys = [J.AC, J.AB, J.BC];
  const res = await Promise.all(users.map((u, i) => hold(client(ctx.base, u), run, journeys[i % 3], [seats[i % 6]])));
  assert.ok(res.every((r) => [201, 409].includes(r.status)), 'only 201/409 expected, got ' + res.map((r) => r.status).join());
  const dup = await query(`SELECT seat_id, seg_idx, count(*) FROM seat_segments WHERE run_id=$1 GROUP BY 1,2 HAVING count(*) > 1`, [run]);
  assert.equal(dup.rowCount, 0);
  // Capacity: 6 seats x 2 hops = 12 hop-slots; every accepted booking consumed exactly its hops
  const used = (await query(`SELECT count(*)::int n FROM seat_segments WHERE run_id=$1`, [run])).rows[0].n;
  assert.ok(used <= 12);
  const expected = res.filter((r) => r.status === 201).reduce((a, r) => a + (r.body.booking.to.code === 'DVG' && r.body.booking.from.code === 'SBC' ? 2 : 1), 0);
  assert.equal(used, expected);
});

test('6/10 full flow: search -> seat map -> hold -> pay -> confirmed -> appears in My bookings', async () => {
  const run = T.runs[3];
  const u = await mkUser(); const api = client(ctx.base, u);
  const date = (await query(`SELECT to_char((start_at AT TIME ZONE 'Asia/Kolkata')::date,'YYYY-MM-DD') d FROM train_runs WHERE id=$1`, [run])).rows[0].d;
  const search = await client(ctx.base)('GET', `/api/trains/search?from=SBC&to=DVG&date=${date}`);
  const hit = search.body.results.find((r) => r.runId === run);
  assert.ok(hit, 'run shows up in search');
  assert.equal(hit.classes.find((c) => c.code === 'CC').farePaise, FARE.CC.AC);
  assert.equal(hit.classes.find((c) => c.code === 'CC').available, 40);

  const map = await api('GET', `/api/runs/${run}/seats?from=SBC&to=DVG`);
  assert.equal(map.status, 200);
  const free = map.body.coaches[0].seats.find((s) => s.state === 'AVAILABLE');
  const held = await hold(api, run, J.AC, [free.id], ['Asha Rao']);
  assert.equal(held.status, 201);
  assert.equal(held.body.booking.status, 'PENDING');
  assert.equal(held.body.booking.amountPaise, FARE.CC.AC, 'price comes from the server');
  assert.ok(held.body.booking.holdSecondsLeft > 280);

  const map2 = await api('GET', `/api/runs/${run}/seats?from=SBC&to=DVG`);
  assert.equal(map2.body.coaches[0].seats.find((s) => s.id === free.id).state, 'MINE');
  const otherMap = await client(ctx.base, await mkUser())('GET', `/api/runs/${run}/seats?from=SBC&to=DVG`);
  assert.equal(otherMap.body.coaches[0].seats.find((s) => s.id === free.id).state, 'HELD');

  const paid = await api('POST', `/api/bookings/${held.body.booking.id}/pay`, OK_CARD, { 'idempotency-key': key() });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.booking.status, 'CONFIRMED');
  assert.equal(paid.body.booking.paidPaise, FARE.CC.AC);
  assert.match(paid.body.booking.pnr, /^[A-Z2-9]{10}$/);
  assert.equal(paid.body.payment.instrument, '•••• 4242');

  const otherMap2 = await client(ctx.base, await mkUser())('GET', `/api/runs/${run}/seats?from=SBC&to=DVG`);
  assert.equal(otherMap2.body.coaches[0].seats.find((s) => s.id === free.id).state, 'BOOKED');

  const mine = await api('GET', '/api/bookings');
  assert.equal(mine.body.bookings.length, 1);
  assert.equal(mine.body.bookings[0].passengers[0].name, 'Asha Rao');
});

test('7/10 failed payment keeps the hold, allows retry, success on 2nd attempt confirms', async () => {
  const run = T.runs[4], seat = T.seats[1];
  const u = await mkUser(); const api = client(ctx.base, u);
  const b = (await hold(api, run, J.AB, [seat])).body.booking;
  const f = await api('POST', `/api/bookings/${b.id}/pay`, DECLINED_CARD, { 'idempotency-key': key() });
  assert.equal(f.status, 402);
  assert.equal(f.body.payment.failureCode, 'CARD_DECLINED');
  assert.equal(f.body.payment.attemptsLeft, 2);
  assert.equal(f.body.booking.status, 'PENDING');
  // seat is STILL held for this user while they retry: a rival cannot take it
  assert.equal((await hold(client(ctx.base, await mkUser()), run, J.AB, [seat])).status, 409);
  const ok = await api('POST', `/api/bookings/${b.id}/pay`, OK_CARD, { 'idempotency-key': key() });
  assert.equal(ok.status, 200); assert.equal(ok.body.booking.status, 'CONFIRMED');
  const n = await query(`SELECT status FROM payments WHERE booking_id=$1 ORDER BY created_at`, [b.id]);
  assert.deepEqual(n.rows.map((r) => r.status), ['FAILED', 'SUCCESS']);
});

test('7/10 three failed payments release the seats for somebody else', async () => {
  const run = T.runs[4], seat = T.seats[2];
  const u = await mkUser(); const api = client(ctx.base, u);
  const b = (await hold(api, run, J.AC, [seat])).body.booking;
  for (let i = 0; i < 3; i++) {
    const r = await api('POST', `/api/bookings/${b.id}/pay`, DECLINED_CARD, { 'idempotency-key': key() });
    assert.equal(r.status, 402);
  }
  const after3 = await api('GET', `/api/bookings/${b.id}`);
  assert.equal(after3.body.booking.status, 'FAILED');
  assert.equal((await segRows(run, seat)).rows.length, 0, 'segments freed');
  assert.equal((await hold(client(ctx.base, await mkUser()), run, J.AC, [seat])).status, 201, 'seat is on sale again');
  const late = await api('POST', `/api/bookings/${b.id}/pay`, OK_CARD, { 'idempotency-key': key() });
  assert.equal(late.status, 409, 'cannot pay a failed booking');
});

test('7/10 idempotency: same key replays the result, never charges twice and does not burn a retry', async () => {
  const run = T.runs[5], seat = T.seats[0];
  const u = await mkUser(); const api = client(ctx.base, u);
  const b = (await hold(api, run, J.AB, [seat])).body.booking;
  const k = key();
  const a1 = await api('POST', `/api/bookings/${b.id}/pay`, DECLINED_CARD, { 'idempotency-key': k });
  const a2 = await api('POST', `/api/bookings/${b.id}/pay`, DECLINED_CARD, { 'idempotency-key': k });
  assert.equal(a1.status, 402); assert.equal(a2.status, 402); assert.equal(a2.body.replayed, true);
  assert.equal(a2.body.booking.paymentAttempts, 1, 'replay did not count as another attempt');
  const k2 = key();
  const p1 = await api('POST', `/api/bookings/${b.id}/pay`, OK_CARD, { 'idempotency-key': k2 });
  const p2 = await api('POST', `/api/bookings/${b.id}/pay`, OK_CARD, { 'idempotency-key': k2 });
  assert.equal(p1.status, 200); assert.equal(p2.status, 200); assert.equal(p2.body.replayed, true);
  assert.equal((await query(`SELECT count(*)::int n FROM payments WHERE booking_id=$1 AND status='SUCCESS'`, [b.id])).rows[0].n, 1);
});

test('7/10 double-click / two tabs: 10 parallel pay calls -> one success, nobody is charged twice', async () => {
  const run = T.runs[6], seat = T.seats[0];
  const u = await mkUser(); const api = client(ctx.base, u);
  const b = (await hold(api, run, J.AC, [seat])).body.booking;
  const res = await Promise.all(Array.from({ length: 10 }, () => api('POST', `/api/bookings/${b.id}/pay`, OK_CARD, { 'idempotency-key': key() })));
  assert.equal(res.filter((r) => r.status === 200).length, 1);
  assert.equal(res.filter((r) => r.status === 409 && r.body.error.code === 'ALREADY_PAID').length, 9);
  assert.equal((await query(`SELECT count(*)::int n FROM payments WHERE booking_id=$1`, [b.id])).rows[0].n, 1);
});

test('7/10 expired hold: seat is freed, late payment is refused (410) and no money is taken', async () => {
  const run = T.runs[7], seat = T.seats[0];
  const u = await mkUser(); const api = client(ctx.base, u);
  const b = (await hold(api, run, J.AC, [seat])).body.booking;
  await query(`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id=$1`, [b.id]);
  // read-side: expired hold already looks free
  const map = await client(ctx.base, await mkUser())('GET', `/api/runs/${run}/seats?from=SBC&to=DVG`);
  assert.equal(map.body.coaches[0].seats.find((s) => s.id === seat).state, 'AVAILABLE');
  const late = await api('POST', `/api/bookings/${b.id}/pay`, OK_CARD, { 'idempotency-key': key() });
  assert.equal(late.status, 410); assert.equal(late.body.error.code, 'HOLD_EXPIRED');
  assert.equal((await query(`SELECT count(*)::int n FROM payments WHERE booking_id=$1`, [b.id])).rows[0].n, 0);
  assert.equal((await segRows(run, seat)).rows.length, 0);
  assert.equal((await api('GET', `/api/bookings/${b.id}`)).body.booking.status, 'EXPIRED');
});

test('7/10 expired hold is taken over by the next buyer without waiting for the sweeper', async () => {
  const run = T.runs[7], seat = T.seats[5];
  const a = client(ctx.base, await mkUser()); const b = client(ctx.base, await mkUser());
  const first = (await hold(a, run, J.AC, [seat])).body.booking;
  assert.equal((await hold(b, run, J.AC, [seat])).status, 409, 'live hold blocks');
  await query(`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id=$1`, [first.id]);
  assert.equal((await hold(b, run, J.AC, [seat])).status, 201, 'expired hold no longer blocks');
  assert.equal((await query(`SELECT status FROM bookings WHERE id=$1`, [first.id])).rows[0].status, 'EXPIRED');
});

test('7/10 user can release a hold; hold limit stops hoarding (max 2 live holds per user)', async () => {
  const run = T.runs[8];
  const u = await mkUser(); const api = client(ctx.base, u);
  const r1 = await hold(api, run, J.AB, [T.seats[0]]); const r2 = await hold(api, run, J.AB, [T.seats[1]]);
  assert.equal(r1.status, 201); assert.equal(r2.status, 201);
  const r3 = await hold(api, run, J.AB, [T.seats[2]]);
  assert.equal(r3.status, 429); assert.equal(r3.body.error.code, 'TOO_MANY_HOLDS');
  await api('POST', `/api/bookings/${r1.body.booking.id}/release`);
  assert.equal((await hold(api, run, J.AB, [T.seats[2]])).status, 201);
  // parallel burst by one user can't exceed the limit either
  const v = await mkUser(); const vapi = client(ctx.base, v);
  const burst = await Promise.all([10, 11, 12, 13, 14].map((i) => hold(vapi, run, J.AB, [T.seats[i]])));
  assert.equal(burst.filter((r) => r.status === 201).length, 2);
});

test('2/10 booking rules: validation and edge cases', async () => {
  const run = T.runs[9];
  const api = client(ctx.base, await mkUser());
  const S = T.seats;
  assert.equal((await hold(api, run, { from: 'DVG', to: 'SBC' }, [S[0]])).status, 422, 'wrong direction');
  assert.equal((await hold(api, run, { from: 'SBC', to: 'MAS' }, [S[0]])).status, 422, 'station not on route');
  assert.equal((await hold(api, run, J.AC, [S[0], S[0]])).status, 422, 'same seat twice');
  assert.equal((await hold(api, run, J.AC, S.slice(0, 7))).status, 422, 'more than 6 passengers');
  assert.equal((await api('POST', '/api/bookings/hold', { runId: run, ...J.AC, passengers: [] })).status, 422, 'zero passengers');
  assert.equal((await api('POST', '/api/bookings/hold', { runId: run, ...J.AC, passengers: [{ seatId: S[0], name: 'A', age: 30, gender: 'O' }] })).status, 422, 'short name');
  assert.equal((await api('POST', '/api/bookings/hold', { runId: run, ...J.AC, passengers: [{ seatId: S[0], name: 'Valid Name', age: 0, gender: 'O' }] })).status, 422, 'age 0');
  assert.equal((await hold(api, run, J.AC, [999999999])).status, 422, 'unknown seat');
  const otherTrainSeat = (await query(`SELECT s.id FROM seats s JOIN trains t ON t.id=s.train_id WHERE t.number='20601' LIMIT 1`)).rows[0].id;
  assert.equal((await hold(api, run, J.AC, [otherTrainSeat])).status, 422, 'seat of a different train');
  assert.equal((await hold(api, '00000000-0000-4000-8000-000000000000', J.AC, [S[0]])).status, 404, 'unknown run');
  // multi-passenger booking: fares add up and mixed classes are priced per class
  const ccSeat = T.seatRows.find((s) => s.class === 'CC').id, ecSeat = T.seatRows.find((s) => s.class === 'EC').id;
  const mixed = await hold(api, run, J.AC, [ccSeat, ecSeat], ['Pat One', 'Pat Two']);
  assert.equal(mixed.status, 201);
  assert.equal(mixed.body.booking.amountPaise, FARE.CC.AC + (230 * 250 + 5000));
});

test('2/10 booking cut-off and departed trains', async () => {
  const run = T.runs[10];
  const api = client(ctx.base, await mkUser());
  await query(`UPDATE train_runs SET start_at = now() + interval '20 minutes' WHERE id=$1`, [run]);
  const r = await hold(api, run, J.AC, [T.seats[0]]);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'BOOKING_CLOSED');
  await query(`UPDATE train_runs SET start_at = now() + interval '45 minutes' WHERE id=$1`, [run]);
  assert.equal((await hold(api, run, J.AC, [T.seats[0]])).status, 201, 'still bookable 45 min before');
  // boarding at a LATER stop uses that stop's departure time, not the origin's (stop TK departs 62 min after origin)
  await query(`UPDATE train_runs SET start_at = now() - interval '20 minutes' WHERE id=$1`, [run]);
  const mid = await hold(client(ctx.base, await mkUser()), run, J.BC, [T.seats[1]]);
  assert.equal(mid.status, 201, 'train left origin 20 min ago; it only departs TK at +62 min, i.e. in 42 min (cut-off 30 min)');
});

test('2/10 cancellation: tiered refund, seats go back on sale, cannot cancel twice or after departure', async () => {
  const cases = [[60, 90], [20, 75], [6, 50], [2, 25]];
  for (const [i, [hours, pct]] of cases.entries()) {
    const run = T.runs[11], seat = T.seats[20 + i];
    await query(`UPDATE train_runs SET start_at = now() + interval '10 days' WHERE id=$1`, [run]);
    const api = client(ctx.base, await mkUser());
    const b = (await hold(api, run, J.AC, [seat])).body.booking;
    await api('POST', `/api/bookings/${b.id}/pay`, OK_CARD, { 'idempotency-key': key() });
    await query(`UPDATE train_runs SET start_at = now() + make_interval(hours => $2) WHERE id=$1`, [run, hours]);
    const detail = await api('GET', `/api/bookings/${b.id}`);
    assert.equal(detail.body.booking.refundIfCancelled.percent, pct, `preview at ${hours}h`);
    const c = await api('POST', `/api/bookings/${b.id}/cancel`);
    assert.equal(c.status, 200);
    assert.equal(c.body.booking.status, 'CANCELLED');
    assert.equal(c.body.booking.refundPaise, Math.floor(FARE.CC.AC * pct / 100), `refund at ${hours}h`);
    assert.equal((await segRows(run, seat)).rows.length, 0);
    const again = await api('POST', `/api/bookings/${b.id}/cancel`);
    assert.equal(again.status, 409); assert.equal(again.body.error.code, 'ALREADY_CANCELLED');
  }
  // departed
  const run = T.runs[11], seat = T.seats[0];
  await query(`UPDATE train_runs SET start_at = now() + interval '10 days' WHERE id=$1`, [run]);
  const api = client(ctx.base, await mkUser());
  const b = (await hold(api, run, J.AC, [seat])).body.booking;
  await api('POST', `/api/bookings/${b.id}/pay`, OK_CARD, { 'idempotency-key': key() });
  await query(`UPDATE train_runs SET start_at = now() - interval '1 hour' WHERE id=$1`, [run]);
  const late = await api('POST', `/api/bookings/${b.id}/cancel`);
  assert.equal(late.status, 409); assert.equal(late.body.error.code, 'ALREADY_DEPARTED');
  // pending bookings cannot be "cancelled" for a refund
  await query(`UPDATE train_runs SET start_at = now() + interval '10 days' WHERE id=$1`, [run]);
  const p = (await hold(api, run, J.AB, [T.seats[7]])).body.booking;
  assert.equal((await api('POST', `/api/bookings/${p.id}/cancel`)).status, 409);
});

test('2/10 organiser cancels a run: holds released, every paid booking refunded 100%, run closed for sale', async () => {
  const run = T.runs[12];
  await query(`UPDATE train_runs SET start_at = now() + interval '12 days' WHERE id=$1`, [run]);
  const u1 = client(ctx.base, await mkUser()), u2 = client(ctx.base, await mkUser());
  const paid = (await hold(u1, run, J.AC, [T.seats[30]])).body.booking;
  await u1('POST', `/api/bookings/${paid.id}/pay`, OK_CARD, { 'idempotency-key': key() });
  const pending = (await hold(u2, run, J.AB, [T.seats[31]])).body.booking;
  const out = await T.api('POST', `/api/organiser/runs/${run}/cancel`, { reason: 'Track maintenance' });
  assert.equal(out.status, 200);
  assert.deepEqual([out.body.refundedBookings, out.body.releasedHolds, out.body.refundedPaise], [1, 1, FARE.CC.AC]);
  const a = (await u1('GET', `/api/bookings/${paid.id}`)).body.booking;
  assert.equal(a.status, 'CANCELLED'); assert.equal(a.refundPaise, FARE.CC.AC); assert.equal(a.cancelledBy, 'ORGANISER');
  assert.equal((await u2('GET', `/api/bookings/${pending.id}`)).body.booking.status, 'EXPIRED');
  assert.equal((await query('SELECT count(*)::int n FROM seat_segments WHERE run_id=$1', [run])).rows[0].n, 0);
  const again = await hold(u2, run, J.AB, [T.seats[32]]);
  assert.equal(again.status, 409); assert.equal(again.body.error.code, 'RUN_CANCELLED');
  assert.equal((await T.api('POST', `/api/organiser/runs/${run}/cancel`, { reason: 'twice' })).status, 409);
});
