import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { memoriesRoutes } from './routes/memories.js';
import { setupRoutes } from './routes/setup.js';
import { stripeWebhookRoutes } from './routes/stripe-webhook.js';
import { openaiProxyRoutes } from './routes/openai-proxy.js';
import { webhookRoutes } from './routes/webhooks.js';
import { feedbackRoutes } from './routes/feedback.js';
import { pool } from './db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate(): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name         TEXT NOT NULL,
      plan         TEXT NOT NULL DEFAULT 'free',
      memory_limit INTEGER NOT NULL DEFAULT 10000,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Add plan/limit/stripe columns if table already exists
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS memory_limit INTEGER NOT NULL DEFAULT 10000;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
    EXCEPTION WHEN others THEN NULL; END $$
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tenants_stripe_customer_id_idx ON tenants(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL`);

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
      embedding        VECTOR(1024),
      importance       FLOAT NOT NULL DEFAULT 0.5,
      decay_score      FLOAT NOT NULL DEFAULT 1.0,
      access_count     INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TIMESTAMPTZ,
      valid_until      TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Fix dimension if table was previously created with VECTOR(1536)
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE memories ALTER COLUMN embedding TYPE vector(1024);
    EXCEPTION WHEN others THEN NULL; END $$
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS memories_embedding_idx
      ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS memories_tenant_user_active_idx
      ON memories(tenant_id, user_id, valid_until) WHERE valid_until IS NULL
  `);

  // Add email to tenants
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email TEXT;
    EXCEPTION WHEN others THEN NULL; END $$
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tenants_email_idx ON tenants(email) WHERE email IS NOT NULL`);

  // v2: Add source and namespace columns
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'api';
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS namespace TEXT NOT NULL DEFAULT 'default';
    EXCEPTION WHEN others THEN NULL; END $$
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS memories_source_idx ON memories(source)`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS memories_tenant_user_ns_active_idx
      ON memories(tenant_id, user_id, namespace, valid_until) WHERE valid_until IS NULL
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    UUID REFERENCES tenants(id) ON DELETE SET NULL,
      type         TEXT NOT NULL CHECK (type IN ('feature', 'bug', 'general')),
      title        TEXT NOT NULL,
      description  TEXT,
      email        TEXT,
      status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'planned', 'done', 'wontfix')),
      votes        INTEGER NOT NULL DEFAULT 1,
      metadata     JSONB DEFAULT '{}',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback(status, type)`);

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

// Serve API docs at /docs (skip if docs dir missing)
import { existsSync } from 'fs';
const docsDir = join(__dirname, '..', 'docs');
if (existsSync(docsDir)) {
  await app.register(fastifyStatic, {
    root: docsDir,
    prefix: '/docs/',
    decorateReply: false,
  });
}

// Webhook routes registered in an encapsulated context so the raw-body
// content-type parser does not conflict with the default JSON parser.
await app.register(webhookRoutes);

await app.register(memoriesRoutes);
await app.register(setupRoutes);
await app.register(stripeWebhookRoutes);
await app.register(openaiProxyRoutes);
await app.register(feedbackRoutes);

const PORT = parseInt(process.env.PORT ?? '3010', 10);

try {
  await migrate();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Smara API listening on port ${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
