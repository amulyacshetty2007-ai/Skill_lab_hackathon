import { Router } from 'express';
import { z } from 'zod';
import { withTx } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { createTrain, scheduleRuns } from '../services/trains.js';
import { dashboard, listRuns, listTrains, manifest, cancelRun, ownedTrain } from '../services/organiser.js';

const uuid = z.object({ id: z.string().uuid() });
const stop = z.object({
  stationCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/),
  arriveOffsetMin: z.number().int().min(0).max(3000),
  departOffsetMin: z.number().int().min(0).max(3000),
  distanceKm: z.number().int().min(0).max(5000),
}).strict();
const trainSchema = z.object({
  number: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{3,8}$/),
  name: z.string().trim().min(3).max(60),
  stops: z.array(stop).min(2).max(15),
  coaches: z.array(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z][0-9]{1,2}$/), class: z.enum(['CC', 'EC']) }).strict()).min(1).max(16),
}).strict();
const scheduleSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), 'Invalid date'),
  days: z.number().int().min(1).max(60),
  departTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).strict();

export function organiserRoutes() {
  const r = Router();
  r.use(authenticate, requireRole('ORGANISER'));

  r.get('/dashboard', validate({ query: z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }).strict() }),
    async (req, res, next) => { try { res.json(await dashboard(req.user.id, req.query.days)); } catch (e) { next(e); } });

  r.get('/trains', async (req, res, next) => { try { res.json({ trains: await listTrains(req.user.id) }); } catch (e) { next(e); } });

  r.post('/trains', validate({ body: trainSchema }), async (req, res, next) => {
    try {
      const train = await withTx((c) => createTrain(c, req.user.id, req.body));
      res.status(201).json({ train });
    } catch (e) { next(e); }
  });

  r.post('/trains/:id/runs', validate({ params: uuid, body: scheduleSchema }), async (req, res, next) => {
    try {
      const created = await withTx(async (c) => {
        await ownedTrain(req.user.id, req.params.id, c);
        return scheduleRuns(c, req.params.id, req.body);
      });
      res.status(201).json({ created });
    } catch (e) { next(e); }
  });

  r.get('/runs', validate({ query: z.object({ scope: z.enum(['upcoming', 'past']).default('upcoming'), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict() }),
    async (req, res, next) => { try { res.json({ runs: await listRuns(req.user.id, req.query) }); } catch (e) { next(e); } });

  r.get('/runs/:id/manifest', validate({ params: uuid }),
    async (req, res, next) => { try { res.json(await manifest(req.user.id, req.params.id)); } catch (e) { next(e); } });

  r.post('/runs/:id/cancel', validate({ params: uuid, body: z.object({ reason: z.string().trim().min(3).max(200) }).strict() }),
    async (req, res, next) => { try { res.json(await cancelRun(req.user.id, req.params.id, req.body.reason, req.ip)); } catch (e) { next(e); } });
  return r;
}
