import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { memoriesRoutes } from './routes/memories.js';
import { setupRoutes } from './routes/setup.js';
import { signupRoutes } from './routes/signup.js';
import { webhookRoutes } from './routes/webhooks.js';
import { openaiProxyRoutes } from './routes/openai-proxy.js';
import { feedbackRoutes } from './routes/feedback.js';
import { teamsRoutes } from './routes/teams.js';
import { graphRoutes } from './routes/graph.js';
import { agentsRoutes } from './routes/agents.js';
import { billingRoutes } from './routes/billing.js';
import { emailRoutes } from './routes/email.js';
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

  // v1.2: Teams
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      slug         TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id, slug)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_members (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id      TEXT NOT NULL,
      email        TEXT,
      role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'read_only')),
      invited_by   TEXT,
      joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(team_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_invitations (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      email        TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'member',
      token        TEXT NOT NULL UNIQUE,
      expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
      accepted_at  TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Add team columns to memories
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';
    EXCEPTION WHEN others THEN NULL; END $$
  `);
  // Add check constraint for visibility (idempotent via exception handler)
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE memories ADD CONSTRAINT memories_visibility_check CHECK (visibility IN ('private', 'team'));
    EXCEPTION WHEN others THEN NULL; END $$
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS memories_team_active_idx
      ON memories(team_id, namespace, valid_until) WHERE team_id IS NOT NULL AND valid_until IS NULL
  `);

  // Plan limits on tenants
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS team_limit INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS members_per_team_limit INTEGER NOT NULL DEFAULT 3;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS agent_limit INTEGER NOT NULL DEFAULT 2;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_skill_limit INTEGER NOT NULL DEFAULT 0;
    EXCEPTION WHEN others THEN NULL; END $$
  `);

  // Team member indexes
  await pool.query(`CREATE INDEX IF NOT EXISTS team_members_user_idx ON team_members(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS team_members_email_idx ON team_members(email) WHERE email IS NOT NULL`);

  // v1.2: Graph edges
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memory_edges (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      from_memory_id    UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      to_memory_id      UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL,
      weight            FLOAT NOT NULL DEFAULT 1.0,
      metadata          JSONB DEFAULT '{}',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(from_memory_id, to_memory_id, relationship_type)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS memory_edges_from_idx ON memory_edges(from_memory_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS memory_edges_to_idx ON memory_edges(to_memory_id)`);

  // v1.2: Agents
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      description   TEXT,
      owner_id      TEXT NOT NULL,
      model         TEXT,
      system_prompt TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS agents_tenant_idx ON agents(tenant_id)`);

  // v1.2: Skills
  await pool.query(`
    CREATE TABLE IF NOT EXISTS skills (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      category    TEXT,
      schema      JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // v1.2: Agent-Skill assignments
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_skills (
      agent_id  UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      skill_id  UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      config    JSONB DEFAULT '{}',
      PRIMARY KEY (agent_id, skill_id)
    )
  `);

  // v1.3: BM25 full-text search
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS fact_tsv tsvector
        GENERATED ALWAYS AS (to_tsvector('english', fact)) STORED;
    EXCEPTION WHEN others THEN NULL; END $$
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS memories_fact_tsv_idx ON memories USING gin(fact_tsv)`);

  console.log('Database migration complete');
}

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
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

const PORT = parseInt(process.env.PORT ?? '3010', 10);

try {
  await migrate();

  await app.register(memoriesRoutes);
  await app.register(setupRoutes);
  await app.register(signupRoutes);
  await app.register(webhookRoutes);
  await app.register(openaiProxyRoutes);
  await app.register(feedbackRoutes);
  await app.register(teamsRoutes);
  await app.register(graphRoutes);
  await app.register(agentsRoutes);
  await app.register(billingRoutes);
  await app.register(emailRoutes);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Smara API listening on port ${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
