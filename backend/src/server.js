import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { seedIfEmpty, topUpRuns } from './db/seed.js';
import { startSweeper, stopSweeper } from './services/holds.js';

async function waitForDb(tries = 30) {
  for (let i = 0; i < tries; i++) {
    try { await pool.query('SELECT 1'); return; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  throw new Error('Database not reachable');
}

await waitForDb();
await migrate();
if (process.env.SEED_DEMO_DATA !== 'false') {
  if (await seedIfEmpty()) console.log('[seed] demo data created');
  else await topUpRuns();
}
startSweeper();

const server = createApp().listen(config.port, () => console.log(`[api] listening on :${config.port} (${config.env})`));
const shutdown = () => { stopSweeper(); server.close(() => pool.end().then(() => process.exit(0))); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
