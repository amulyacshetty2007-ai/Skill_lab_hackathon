import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { setup, teardown, mkUser, client, makeTrain, hold, J, key, OK_CARD, query, config, pax } from './helpers.js';

let ctx, T;
before(async () => { ctx = await setup(); T = await makeTrain(ctx.base, { runs: 3 }); });
after(() => teardown(ctx));
const anon = () => client(ctx.base);

test('8/10 no session -> 401 on every protected area', async () => {
  for (const [m, p] of [['GET', '/api/bookings'], ['POST', '/api/bookings/hold'], ['GET', '/api/organiser/dashboard'], ['GET', '/api/auth/me']]) {
    assert.equal((await anon()(m, p, m === 'POST' ? {} : undefined)).status, 401, `${m} ${p}`);
  }
});

test('8/10 roles: users cannot use organiser APIs, organisers cannot book (no wash-trading own trains)', async () => {
  const user = client(ctx.base, await mkUser('USER'));
  assert.equal((await user('GET', '/api/organiser/dashboard')).status, 403);
  assert.equal((await user('POST', '/api/organiser/trains', {})).status, 403);
  assert.equal((await user('POST', `/api/organiser/runs/${T.runs[0]}/cancel`, { reason: 'nope nope' })).status, 403);
  const r = await hold(T.api, T.runs[0], J.AC, [T.seats[0]]);
  assert.equal(r.status, 403);
  assert.equal((await T.api('GET', '/api/bookings')).status, 403);
});

test('8/10 IDOR: a user cannot read, pay, release or cancel another user\'s booking (404, nothing changes)', async () => {
  const alice = client(ctx.base, await mkUser()), mallory = client(ctx.base, await mkUser());
  const b = (await hold(alice, T.runs[0], J.AC, [T.seats[0]])).body.booking;
  for (const [m, p, body, h] of [
    ['GET', `/api/bookings/${b.id}`], ['POST', `/api/bookings/${b.id}/release`], ['POST', `/api/bookings/${b.id}/cancel`],
    ['POST', `/api/bookings/${b.id}/pay`, OK_CARD, { 'idempotency-key': key() }],
  ]) {
    const r = await mallory(m, p, body, h);
    assert.equal(r.status, 404, `${m} ${p}`);
    assert.equal(r.body.error.code, 'BOOKING_NOT_FOUND');
  }
  const still = await alice('GET', `/api/bookings/${b.id}`);
  assert.equal(still.body.booking.status, 'PENDING');
  assert.equal((await query('SELECT count(*)::int n FROM payments WHERE booking_id=$1', [b.id])).rows[0].n, 0);
  assert.equal((await mallory('GET', '/api/bookings')).body.bookings.length, 0, 'list only shows own bookings');
});

test('8/10 organisers are walled off from each other (404, not 403 => ids are not even confirmable)', async () => {
  const other = client(ctx.base, await mkUser('ORGANISER'));
  assert.equal((await other('GET', `/api/organiser/runs/${T.runs[0]}/manifest`)).status, 404);
  assert.equal((await other('POST', `/api/organiser/runs/${T.runs[0]}/cancel`, { reason: 'sabotage' })).status, 404);
  assert.equal((await other('POST', `/api/organiser/trains/${T.trainId}/runs`, { startDate: '2030-01-01', days: 1, departTime: '08:00' })).status, 404);
  assert.equal((await other('GET', '/api/organiser/trains')).body.trains.length, 0);
  assert.equal((await query('SELECT status FROM train_runs WHERE id=$1', [T.runs[0]])).rows[0].status, 'SCHEDULED');
});

test('8/10 cheating: client-supplied price/status/role/user fields are rejected, price is server-side', async () => {
  const api = client(ctx.base, await mkUser());
  const base = { runId: T.runs[1], ...J.AC, passengers: [pax(T.seats[0])] };
  for (const extra of [{ amountPaise: 1 }, { price: 1 }, { status: 'CONFIRMED' }, { userId: '00000000-0000-4000-8000-000000000000' }]) {
    const r = await api('POST', '/api/bookings/hold', { ...base, ...extra });
    assert.equal(r.status, 422, JSON.stringify(extra));
  }
  const r = await api('POST', '/api/bookings/hold', { ...base, passengers: [{ ...pax(T.seats[0]), farePaise: 1 }] });
  assert.equal(r.status, 422);
  const b = await hold(api, T.runs[1], J.AC, [T.seats[0]]);
  assert.equal(b.body.booking.amountPaise, 110 * 250 + 3000);
  // cannot mark own booking paid by calling pay with junk fields
  const p = await api('POST', `/api/bookings/${b.body.booking.id}/pay`, { ...OK_CARD, amountPaise: 1, status: 'SUCCESS' }, { 'idempotency-key': key() });
  assert.equal(p.status, 422);
  assert.equal((await api('POST', `/api/bookings/${b.body.booking.id}/pay`, OK_CARD)).status, 400, 'Idempotency-Key required');
});

test('8/10 privilege escalation: role cannot be chosen at sign-up; organiser needs the secret invite code', async () => {
  const email = () => `reg-${Math.random().toString(36).slice(2)}@test.dev`;
  const pw = 'Str0ngPassw0rd';
  assert.equal((await anon()('POST', '/api/auth/register', { name: 'Eve Evil', email: email(), password: pw, role: 'ORGANISER' })).status, 422);
  assert.equal((await anon()('POST', '/api/auth/register', { name: 'Eve Evil', email: email(), password: pw, organiserCode: 'guess' })).status, 403);
  const good = await anon()('POST', '/api/auth/register', { name: 'Olive Org', email: email(), password: pw, organiserCode: config.organiserInviteCode });
  assert.equal(good.status, 201); assert.equal(good.body.user.role, 'ORGANISER');
  const plain = await anon()('POST', '/api/auth/register', { name: 'Plain User', email: email(), password: pw });
  assert.equal(plain.body.user.role, 'USER');
  assert.equal((await anon()('POST', '/api/auth/register', { name: 'Weak', email: email(), password: 'password' })).status, 422, 'weak password');
  const dupe = email();
  await anon()('POST', '/api/auth/register', { name: 'First', email: dupe, password: pw });
  assert.equal((await anon()('POST', '/api/auth/register', { name: 'Second', email: dupe.toUpperCase(), password: pw })).status, 409, 'case-insensitive unique email');
});

test('8/10 session tokens: forged, alg=none, wrong-secret and revoked tokens are all rejected', async () => {
  const u = await mkUser();
  const forged = jwt.sign({ sub: u.id, role: 'ORGANISER', tv: 0 }, 'attacker-secret-attacker-secret-1234');
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: u.id, role: 'ORGANISER', tv: 0 })).toString('base64url')}.`;
  for (const t of [forged, none, 'garbage']) {
    assert.equal((await client(ctx.base, { token: t })('GET', '/api/auth/me')).status, 401);
  }
  // role in the token is ignored: DB role wins. Same user, honest token: USER can't reach organiser API
  assert.equal((await client(ctx.base, u)('GET', '/api/organiser/dashboard')).status, 403);
  // logout revokes the token everywhere
  const api = client(ctx.base, u);
  assert.equal((await api('GET', '/api/auth/me')).status, 200);
  assert.equal((await api('POST', '/api/auth/logout')).status, 200);
  assert.equal((await api('GET', '/api/auth/me')).status, 401, 'old token is dead after logout');
});

test('8/10 login: cookie is HttpOnly + SameSite=Strict, no password hash ever leaks, lockout after 5 failures', async () => {
  const email = `login-${Math.random().toString(36).slice(2)}@test.dev`;
  const reg = await anon()('POST', '/api/auth/register', { name: 'Lock Test', email, password: 'Str0ngPassw0rd' });
  assert.equal(reg.status, 201);
  const ok = await anon()('POST', '/api/auth/login', { email, password: 'Str0ngPassw0rd' });
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Strict/i);
  assert.ok(!JSON.stringify(ok.body).includes('hash'));
  assert.ok(!JSON.stringify((await anon()('POST', '/api/auth/login', { email, password: 'Str0ngPassw0rd' })).body).includes('$2'));
  // unknown user and wrong password look identical
  const a = await anon()('POST', '/api/auth/login', { email: 'nobody@test.dev', password: 'Whatever123' });
  const b = await anon()('POST', '/api/auth/login', { email, password: 'WrongPass123' });
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.deepEqual(a.body, b.body);
  for (let i = 0; i < 4; i++) await anon()('POST', '/api/auth/login', { email, password: 'WrongPass123' });
  const locked = await anon()('POST', '/api/auth/login', { email, password: 'Str0ngPassw0rd' });
  assert.equal(locked.status, 423, 'even the right password is refused while locked');
});

test('8/10 CSRF: state-changing request from a foreign Origin is blocked even with a valid cookie', async () => {
  const u = await mkUser();
  const evil = client(ctx.base, u, { origin: 'https://evil.example' });
  assert.equal((await evil('POST', '/api/auth/logout')).status, 403);
  const own = client(ctx.base, u, { origin: config.allowedOrigins[0] });
  assert.equal((await own('GET', '/api/auth/me')).status, 200);
});

test('8/10 injection and malformed input: SQLi strings never reach SQL; bad JSON and huge bodies give clean errors', async () => {
  const api = client(ctx.base, await mkUser());
  assert.equal((await anon()('GET', `/api/trains/search?from=${encodeURIComponent("SBC' OR '1'='1")}&to=DVG&date=2030-01-01`)).status, 422);
  assert.equal((await anon()('GET', '/api/trains/search?from=SBC&to=DVG&date=2030-13-45')).status, 422);
  assert.equal((await anon()('GET', '/api/runs/not-a-uuid/seats?from=SBC&to=DVG')).status, 422);
  const r = await api('POST', '/api/bookings/hold', { runId: T.runs[2], ...J.AC, passengers: [{ seatId: T.seats[0], name: "Robert'); DROP TABLE users;--", age: 30, gender: 'M' }] });
  assert.equal(r.status, 422);
  assert.equal((await query('SELECT count(*)::int n FROM users')).rows[0].n > 0, true);
  const bad = await fetch(ctx.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(bad.status, 400); const txt = await bad.text(); assert.ok(!/at .*\.js/.test(txt), 'no stack trace');
  const big = await fetch(ctx.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(50000) }) });
  assert.equal(big.status, 413);
  assert.equal((await anon()('GET', '/api/nope')).status, 404);
});

test('8/10 card data: the full card number is never stored or logged, only the last 4 digits', async () => {
  const api = client(ctx.base, await mkUser());
  const b = (await hold(api, T.runs[2], J.AB, [T.seats[9]])).body.booking;
  await api('POST', `/api/bookings/${b.id}/pay`, { method: 'CARD', card: { number: '4111 1111 1111 1111', expiry: '12/39', cvv: '999' } }, { 'idempotency-key': key() });
  const dump = JSON.stringify((await query('SELECT * FROM payments WHERE booking_id=$1', [b.id])).rows)
    + JSON.stringify((await query('SELECT * FROM audit_log WHERE entity_id=$1', [b.id])).rows);
  assert.ok(!dump.includes('4111111111111111') && !dump.includes('4111 1111') && !dump.includes('999'));
  assert.ok(dump.includes('•••• 1111'));
});

test('8/10 rate limiting: brute-forcing login and hammering payment are throttled (429)', async () => {
  const strict = await setup({ rateLimits: { global: 100000, auth: 3, pay: 2, hold: 100000 } });
  try {
    const a = client(strict.base);
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await a('POST', '/api/auth/login', { email: 'x@test.dev', password: 'Whatever1' })).status);
    assert.deepEqual(codes, [401, 401, 401, 429, 429]);
    const u = client(strict.base, await mkUser());
    const pays = [];
    for (let i = 0; i < 4; i++) pays.push((await u('POST', `/api/bookings/00000000-0000-4000-8000-000000000000/pay`, OK_CARD, { 'idempotency-key': key() })).status);
    assert.equal(pays.filter((s) => s === 429).length, 2);
  } finally { await strict.close(); }
});

test('8/10 security headers are set', async () => {
  const r = await anon()('GET', '/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('content-security-policy'));
  assert.equal(r.headers.get('x-powered-by'), null);
});
