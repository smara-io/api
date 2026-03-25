import Fastify from 'fastify';
import cors from '@fastify/cors';
import { memoriesRoutes } from './routes/memories.js';
import { pool } from './db/pool.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'DELETE'],
});

// Health check — no auth required
app.get('/health', async () => {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return { status: 'ok', db: rows[0].ok === 1 ? 'ok' : 'error' };
});

await app.register(memoriesRoutes);

const PORT = parseInt(process.env.PORT ?? '3010', 10);

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Smara API listening on port ${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
