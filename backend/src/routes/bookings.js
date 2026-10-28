import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { HttpError } from '../utils/httpError.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { createHold, pay, release, cancel, getBookingView, listBookings } from '../services/bookings.js';

const id = z.object({ id: z.string().uuid() });

// .strict() = unknown keys are an error. A client that tries to send {amount: 1} or {status: 'CONFIRMED'} is rejected.
const holdSchema = z.object({
  runId: z.string().uuid(),
  from: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/),
  to: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/),
  passengers: z.array(z.object({
    seatId: z.number().int().positive(),
    name: z.string().trim().min(2).max(60).regex(/^[\p{L} .'-]+$/u, 'Letters, spaces and . \' - only'),
    age: z.number().int().min(1).max(120),
    gender: z.enum(['M', 'F', 'O']),
  }).strict()).min(1).max(config.maxPassengers),
}).strict();

const paySchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('CARD'), card: z.object({
    number: z.string().min(12).max(23), expiry: z.string().regex(/^\d{2}\/\d{2}$/), cvv: z.string().regex(/^\d{3,4}$/),
    holder: z.string().trim().max(60).optional() }).strict() }).strict(),
  z.object({ method: z.literal('UPI'), upi: z.object({ vpa: z.string().trim().regex(/^[\w.-]{2,40}@[A-Za-z]{2,20}$/, 'Enter a valid UPI id') }).strict() }).strict(),
]);

export function bookingRoutes({ holdLimiter, payLimiter }) {
  const r = Router();
  r.use(authenticate);

  r.get('/', requireRole('USER'), async (req, res, next) => {
    try { res.json({ bookings: await listBookings(req.user.id) }); } catch (e) { next(e); }
  });

  r.post('/hold', requireRole('USER'), holdLimiter, validate({ body: holdSchema }), async (req, res, next) => {
    try { res.status(201).json({ booking: await createHold(req.user, req.body, req.ip) }); } catch (e) { next(e); }
  });

  r.get('/:id', requireRole('USER'), validate({ params: id }), async (req, res, next) => {
    try { res.json({ booking: await getBookingView(req.params.id, req.user.id) }); } catch (e) { next(e); }
  });

  r.post('/:id/pay', requireRole('USER'), payLimiter, validate({ params: id, body: paySchema }), async (req, res, next) => {
    try {
      const key = req.get('idempotency-key');
      if (!key || key.length < 8 || key.length > 100) {
        throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (8-100 chars) so retries never double-charge');
      }
      const out = await pay(req.user, req.params.id, key, req.body, req.ip);
      res.status(out.payment.status === 'SUCCESS' ? 200 : 402).json(out);
    } catch (e) { next(e); }
  });

  r.post('/:id/release', requireRole('USER'), validate({ params: id }), async (req, res, next) => {
    try { res.json({ booking: await release(req.user, req.params.id, req.ip) }); } catch (e) { next(e); }
  });

  r.post('/:id/cancel', requireRole('USER'), validate({ params: id }), async (req, res, next) => {
    try { res.json({ booking: await cancel(req.user, req.params.id, req.ip) }); } catch (e) { next(e); }
  });
  return r;
}
