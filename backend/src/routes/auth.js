import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { HttpError } from '../utils/httpError.js';
import { validate } from '../middleware/validate.js';
import { authenticate, signSession, setSessionCookie, clearSessionCookie } from '../middleware/auth.js';

const password = z.string().min(8, 'At least 8 characters').max(72, 'At most 72 characters')
  .regex(/[a-z]/, 'Needs a lowercase letter').regex(/[A-Z]/, 'Needs an uppercase letter').regex(/\d/, 'Needs a digit');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password,
  organiserCode: z.string().max(100).optional(),
}).strict();
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(72),
}).strict();

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
// Constant-time-ish dummy hash so unknown emails take as long as known ones (no user enumeration by timing)
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

function safeEqual(a, b) {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function authRoutes({ authLimiter }) {
  const r = Router();

  r.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res, next) => {
    try {
      const { name, email, password: pw, organiserCode } = req.body;
      // Privilege escalation guard: role is NEVER taken from the request. Organiser needs a secret invite code.
      let role = 'USER';
      if (organiserCode !== undefined && organiserCode !== '') {
        if (!config.organiserInviteCode || !safeEqual(organiserCode, config.organiserInviteCode)) {
          throw new HttpError(403, 'BAD_INVITE', 'That organiser invite code is not valid');
        }
        role = 'ORGANISER';
      }
      const hash = await bcrypt.hash(pw, config.bcryptCost);
      let user;
      try {
        user = (await query(
          'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role, token_version',
          [name, email, hash, role])).rows[0];
      } catch (e) {
        if (e.code === '23505') throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
        throw e;
      }
      setSessionCookie(res, signSession(user));
      res.status(201).json({ user: publicUser(user) });
    } catch (e) { next(e); }
  });

  r.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res, next) => {
    try {
      const { email, password: pw } = req.body;
      const u = (await query('SELECT *, (locked_until IS NOT NULL AND locked_until > now()) AS locked FROM users WHERE lower(email) = $1', [email])).rows[0];
      const ok = await bcrypt.compare(pw, u ? u.password_hash : DUMMY_HASH);
      if (u?.locked) throw new HttpError(423, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${config.lockoutMinutes} minutes.`);
      if (!u || !ok) {
        if (u) {
          await query(
            `UPDATE users SET failed_logins = failed_logins + 1,
                    locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
              WHERE id = $1`, [u.id, config.lockoutThreshold, config.lockoutMinutes]);
        }
        // Same message for "no such user" and "wrong password"
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }
      await query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
      setSessionCookie(res, signSession(u));
      res.json({ user: publicUser(u) });
    } catch (e) { next(e); }
  });

  r.post('/logout', authenticate, async (req, res, next) => {
    try {
      // Bumping token_version invalidates every session of this user, not just this browser.
      await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
      clearSessionCookie(res);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));
  return r;
}
