import Fastify from 'fastify';
import cors from '@fastify/cors';
import { memoriesRoutes } from './routes/memories.js';
import { setupRoutes } from './routes/setup.js';
import { pool } from './db/pool.js';

async function migrate(): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      key_hash     TEXT NOT NULL UNIQUE,
      label        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys(key_hash)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS memories (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id          TEXT NOT NULL,
      fact             TEXT NOT NULL,
      embedding        VECTOR(1536),
      importance       FLOAT NOT NULL DEFAULT 0.5,
      decay_score      FLOAT NOT NULL DEFAULT 1.0,
      access_count     INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMPTZ,
      valid_until      TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS memories_embedding_idx
      ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS memories_tenant_user_active_idx
      ON memories(tenant_id, user_id, valid_until) WHERE valid_until IS NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS retrieval_logs (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id      TEXT NOT NULL,
      endpoint     TEXT NOT NULL,
      result_count INTEGER,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log('Database migration complete');
}

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
await app.register(setupRoutes);

const PORT = parseInt(process.env.PORT ?? '3010', 10);

try {
  await migrate();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Smara API listening on port ${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
