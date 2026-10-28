import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { originGuard } from './middleware/origin.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { bookingRoutes } from './routes/bookings.js';
import { organiserRoutes } from './routes/organiser.js';

const limiter = (max, windowMs, keyByUser = false) => rateLimit({
  windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: keyByUser ? (req) => req.user?.id || req.ip : undefined,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down and try again shortly.' } },
});

export function createApp(overrides = {}) {
  const rl = { ...config.rateLimits, ...overrides.rateLimits };
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
  if (!config.isTest) app.use(morgan(config.isProd ? 'combined' : 'dev'));
  app.use(limiter(rl.global, 60_000));
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());
  app.use(originGuard(config.allowedOrigins));

  app.get('/api/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'ok' }); }
    catch { res.status(503).json({ status: 'db_unavailable' }); }
  });

  const authLimiter = limiter(rl.auth, 15 * 60_000);
  const payLimiter = limiter(rl.pay, 60_000, true);
  const holdLimiter = limiter(rl.hold, 60_000, true);

  app.use('/api/auth', authRoutes({ authLimiter }));
  app.use('/api', publicRoutes());
  app.use('/api/bookings', bookingRoutes({ holdLimiter, payLimiter }));
  app.use('/api/organiser', organiserRoutes());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
