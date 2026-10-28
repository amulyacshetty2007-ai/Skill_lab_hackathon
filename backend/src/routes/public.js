import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { validate } from '../middleware/validate.js';
import { optionalAuth } from '../middleware/auth.js';
import { searchTrains, seatMap } from '../services/availability.js';

const code = z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/);
export function publicRoutes() {
  const r = Router();

  r.get('/stations', async (_req, res, next) => {
    try { res.json({ stations: (await query('SELECT code, name, city FROM stations ORDER BY city, name')).rows }); }
    catch (e) { next(e); }
  });

  r.get('/trains/search',
    validate({ query: z.object({ from: code, to: code, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), 'Invalid date') }).strict() }),
    async (req, res, next) => {
      try {
        if (req.query.from === req.query.to) return res.json({ results: [] });
        res.json({ results: await searchTrains(req.query) });
      } catch (e) { next(e); }
    });

  r.get('/runs/:runId/seats', optionalAuth,
    validate({ params: z.object({ runId: z.string().uuid() }), query: z.object({ from: code, to: code }).strict() }),
    async (req, res, next) => {
      try { res.json(await seatMap({ runId: req.params.runId, from: req.query.from, to: req.query.to, userId: req.user?.id })); }
      catch (e) { next(e); }
    });

  // Live "departure board" for the home page: next departures with seats still free end-to-end.
  r.get('/departures/next', async (_req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT r.id AS run_id, t.number, t.name, r.start_at, o.code AS from_code, o.city AS from_city, d.code AS to_code, d.city AS to_city,
                (SELECT count(*)::int FROM seats s WHERE s.train_id = t.id
                   AND NOT EXISTS (SELECT 1 FROM seat_segments ss JOIN bookings b ON b.id = ss.booking_id
                                    WHERE ss.run_id = r.id AND ss.seat_id = s.id AND (b.status = 'CONFIRMED' OR (b.status = 'PENDING' AND b.hold_expires_at > now())))) AS free_seats,
                (SELECT count(*)::int FROM seats s WHERE s.train_id = t.id) AS total_seats
           FROM train_runs r JOIN trains t ON t.id = r.train_id
           JOIN train_stops fs ON fs.train_id = t.id AND fs.seq = 0 JOIN stations o ON o.id = fs.station_id
           JOIN train_stops ls ON ls.train_id = t.id AND ls.seq = (SELECT max(seq) FROM train_stops WHERE train_id = t.id)
           JOIN stations d ON d.id = ls.station_id
          WHERE r.status = 'SCHEDULED' AND r.start_at > now() + interval '30 minutes'
          ORDER BY r.start_at LIMIT 7`);
      res.json({ departures: rows.map((x) => ({
        runId: x.run_id, trainNumber: x.number, trainName: x.name, departsAt: x.start_at,
        from: { code: x.from_code, city: x.from_city }, to: { code: x.to_code, city: x.to_city },
        freeSeats: x.free_seats, totalSeats: x.total_seats })) });
    } catch (e) { next(e); }
  });
  return r;
}
