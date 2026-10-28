import { pool } from '../db/pool.js';
import { config } from '../config.js';

/**
 * Release expired holds: PENDING -> EXPIRED and free their seat segments.
 * FOR UPDATE SKIP LOCKED means two sweepers (or a sweeper and a booking request) never fight over the same rows.
 * Pass a client to run inside an existing transaction, optionally limited to one run.
 */
export async function expireHolds(db = pool, runId = null) {
  const res = await db.query(
    `WITH exp AS (
       UPDATE bookings SET status = 'EXPIRED', cancelled_at = now(), cancelled_by = 'SYSTEM', cancel_reason = 'HOLD_EXPIRED'
        WHERE id IN (SELECT id FROM bookings
                      WHERE status = 'PENDING' AND hold_expires_at <= now() AND ($1::uuid IS NULL OR run_id = $1)
                      ORDER BY id FOR UPDATE SKIP LOCKED)
        RETURNING id)
     DELETE FROM seat_segments WHERE booking_id IN (SELECT id FROM exp)`, [runId]);
  return res.rowCount;
}

let timer = null;
export function startSweeper() {
  timer = setInterval(() => {
    expireHolds().catch((e) => console.error('[sweeper]', e.message));
  }, config.sweepIntervalMs);
  timer.unref();
}
export const stopSweeper = () => timer && clearInterval(timer);
