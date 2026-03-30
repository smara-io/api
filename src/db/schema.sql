-- Smara Memory API — Database Schema
-- Run once on a fresh Railway PostgreSQL instance after enabling pgvector:
--   CREATE EXTENSION IF NOT EXISTS vector;
--   psql $DATABASE_URL -f schema.sql

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Tenants ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'free',          -- 'free' | 'developer' | 'pro'
  memory_limit  INTEGER NOT NULL DEFAULT 10000,        -- max active memories
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── API Keys ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,   -- SHA-256 hex of the raw key
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys(key_hash);

-- ── Memories ─────────────────────────────────────────────────────────────────
-- user_id is a tenant-controlled string (e.g. "user_123") — NOT a DB foreign key.
-- Tenants manage their own user namespaces.
CREATE TABLE IF NOT EXISTS memories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL,
  fact             TEXT NOT NULL,
  embedding        VECTOR(1536),        -- OpenAI text-embedding-3-small
  importance       FLOAT NOT NULL DEFAULT 0.5,   -- 0.0 – 1.0
  decay_score      FLOAT NOT NULL DEFAULT 1.0,   -- recomputed on retrieval
  access_count     INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  valid_until      TIMESTAMPTZ,         -- NULL = active; set = soft-deleted
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vector similarity search (cosine)
CREATE INDEX IF NOT EXISTS memories_embedding_idx
  ON memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Tenant + user + active filter (most common query pattern)
CREATE INDEX IF NOT EXISTS memories_tenant_user_active_idx
  ON memories(tenant_id, user_id, valid_until)
  WHERE valid_until IS NULL;

-- ── Retrieval Log (optional, for usage metering) ─────────────────────────────
CREATE TABLE IF NOT EXISTS retrieval_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  endpoint    TEXT NOT NULL,   -- 'search' | 'context'
  result_count INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS retrieval_logs_tenant_created_idx
  ON retrieval_logs(tenant_id, created_at DESC);
