-- Migration 001: Add BM25 full-text search support
-- Run against Railway PostgreSQL:
--   psql $DATABASE_URL -f src/db/migrations/001_add_bm25.sql

-- Generated tsvector column for BM25 keyword search
ALTER TABLE memories ADD COLUMN IF NOT EXISTS fact_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', fact)) STORED;

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS memories_fact_tsv_idx ON memories USING gin(fact_tsv);
