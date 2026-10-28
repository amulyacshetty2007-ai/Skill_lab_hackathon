import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { HttpError } from '../utils/httpError.js';

export function signSession(user) {
  return jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, config.jwtSecret, {
    algorithm: 'HS256', expiresIn: config.jwtTtlSeconds,
  });
}

export function setSessionCookie(res, token) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,                 // JavaScript can't read it -> XSS can't steal it
    sameSite: 'strict',             // never sent on cross-site requests -> CSRF
    secure: config.cookieSecure,
    maxAge: config.jwtTtlSeconds * 1000,
    path: '/',
  });
}
export const clearSessionCookie = (res) => res.clearCookie(config.cookieName, { path: '/' });

async function load(req) {
  const token = req.cookies?.[config.cookieName]
    || (req.get('authorization')?.startsWith('Bearer ') ? req.get('authorization').slice(7) : null);
  if (!token) return null;
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }); } catch { return null; }
  // Re-check the user in the DB every request: deleted users and revoked tokens (token_version) stop working at once,
  // and the role is taken from the database, never trusted from the token.
  const { rows } = await query('SELECT id, name, email, role, token_version FROM users WHERE id = $1', [payload.sub]);
  const u = rows[0];
  if (!u || u.token_version !== payload.tv) return null;
  return u;
}

export const authenticate = async (req, _res, next) => {
  try {
    const u = await load(req);
    if (!u) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
    req.user = u; next();
  } catch (e) { next(e); }
};

export const optionalAuth = async (req, _res, next) => {
  try { req.user = (await load(req)) || null; next(); } catch (e) { next(e); }
};

export const requireRole = (role) => (req, _res, next) =>
  req.user?.role === role ? next() : next(new HttpError(403, 'FORBIDDEN', `This action is only available to ${role.toLowerCase()}s`));
