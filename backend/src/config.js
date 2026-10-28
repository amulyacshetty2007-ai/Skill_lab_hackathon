// All configuration comes from environment variables. Nothing secret is hard-coded.
import crypto from 'node:crypto';

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

function secret() {
  if (env.JWT_SECRET && env.JWT_SECRET.length >= 32) return env.JWT_SECRET;
  if (isProd) {
    throw new Error('JWT_SECRET must be set to a random string of at least 32 characters in production');
  }
  // Dev/test only: random per process so no default secret ever exists in the codebase.
  return crypto.randomBytes(48).toString('hex');
}

export const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  isTest,
  port: Number(env.PORT || 4000),
  databaseUrl: env.DATABASE_URL || 'postgres://railrush:railrush@localhost:5432/railrush',
  jwtSecret: secret(),
  jwtTtlSeconds: Number(env.JWT_TTL_SECONDS || 2 * 60 * 60),
  cookieName: 'rr_session',
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
  allowedOrigins: (env.ALLOWED_ORIGINS || 'http://localhost:8080,http://localhost:5173')
    .split(',').map((s) => s.trim()).filter(Boolean),
  bcryptCost: Number(env.BCRYPT_COST || (isTest ? 4 : 12)),
  organiserInviteCode: env.ORGANISER_INVITE_CODE || (isProd ? '' : 'RAILRUSH-ORG-2026'),

  // Booking rules (see docs/BOOKING_RULES.md)
  holdSeconds: Number(env.HOLD_SECONDS || 300),          // seat hold while paying
  maxPassengers: 6,
  maxActiveHoldsPerUser: 2,
  maxPaymentAttempts: 3,
  bookingCutoffMinutes: 30,                               // booking closes 30 min before boarding departure
  sweepIntervalMs: Number(env.SWEEP_INTERVAL_MS || 15000),
  lockoutThreshold: 5,
  lockoutMinutes: 15,
  rateLimits: {
    global: Number(env.RL_GLOBAL || 600),
    auth: Number(env.RL_AUTH || 20),
    pay: Number(env.RL_PAY || 15),
    hold: Number(env.RL_HOLD || 30),
  },
  trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : 0,
};
