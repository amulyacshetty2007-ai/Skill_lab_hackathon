// Idempotent schema migration: safe to run on every start.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function migrate() {
  const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    // Advisory lock so two containers starting together don't race on DDL.
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(sql);
    await client.query(`
      INSERT INTO seat_classes (code, name, rate_paise_km, reservation_fee_paise, seat_rows, cols, aisle_after) VALUES
        ('CC', 'Chair Car',       110, 3000, 8, 'ABCDE', 2),
        ('EC', 'Executive Chair', 230, 5000, 5, 'ABCD',  2)
      ON CONFLICT (code) DO NOTHING`);
    await client.query('SELECT pg_advisory_unlock(727274)');
  } finally {
    client.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => { console.log('schema is up to date'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
