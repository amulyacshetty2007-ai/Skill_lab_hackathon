import pg from 'pg';
import { config } from '../config.js';

// Keep BIGINT/NUMERIC readable: ids are small, money is integer paise.
pg.types.setTypeParser(20, (v) => Number(v));   // int8 -> number (seat ids, counts)
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric -> number

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.PG_POOL_MAX || 20),
  idleTimeoutMillis: 30_000,
  statement_timeout: 10_000,
  query_timeout: 15_000,
});

pool.on('error', (err) => console.error('[pg] idle client error', err.message));

export const query = (text, params) => pool.query(text, params);

/**
 * Run fn inside a transaction. Retries automatically on deadlock (40P01) and
 * serialization failure (40001), which are expected under heavy contention.
 */
export async function withTx(fn, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
      if ((err.code === '40P01' || err.code === '40001') && attempt < retries) {
        await new Promise((r) => setTimeout(r, 15 + Math.random() * 40 * (attempt + 1)));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
