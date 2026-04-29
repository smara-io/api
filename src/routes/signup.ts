/**
 * Auth routes — signup, login, API key management
 *
 * Uses bcrypt for password hashing, JWT for session tokens.
 * API keys are stored as SHA-256 hashes; plaintext returned only on creation.
 */

import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../db/pool.js';
import { enqueueDripSequence } from './email.js';

const BCRYPT_ROUNDS = 12;
const JWT_SECRET = process.env.JWT_SECRET ?? 'smara-dev-jwt-secret-change-in-prod';
const JWT_EXPIRES_IN = '30d';

/* ── Helpers ───────────────────────────────────────────────────── */

function generateApiKey(): string {
  return `smara_${randomBytes(32).toString('hex')}`;
}

function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function signJwt(payload: { tenantId: string; userId: string; email: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyJwt(token: string): { tenantId: string; userId: string; email: string } {
  return jwt.verify(token, JWT_SECRET) as any;
}

/** Middleware: authenticate via JWT Bearer token (not API key) */
async function authenticateJwt(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = verifyJwt(token);
    (request as any).jwtPayload = decoded;
    request.tenantId = decoded.tenantId;
  } catch {
    reply.code(401).send({ error: 'Invalid or expired token' });
  }
}

// Simple in-memory rate limiter
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const AUTH_LIMIT = 10;
const AUTH_WINDOW_MS = 15 * 60 * 1000; // 15 min

function checkAuthRate(request: FastifyRequest): boolean {
  const ip = request.ip;
  const now = Date.now();
  const entry = authAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    authAttempts.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    return true;
  }
  if (entry.count >= AUTH_LIMIT) return false;
  entry.count++;
  return true;
}

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of authAttempts) {
    if (now > entry.resetAt) authAttempts.delete(ip);
  }
}, 10 * 60 * 1000).unref();

/* ── DB migration for users table ──────────────────────────────── */

export async function migrateUsersTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email        TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS users_email_idx ON users(email)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS users_tenant_idx ON users(tenant_id)`);
}

/* ── Routes ────────────────────────────────────────────────────── */

export async function signupRoutes(app: FastifyInstance): Promise<void> {

  // Run migration on registration
  await migrateUsersTable();

  /* ─── POST /v1/auth/signup ───────────────────────────────────── */
  app.post<{
    Body: { email: string; password: string };
  }>('/v1/auth/signup', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8, maxLength: 128 },
        },
      },
    },
  }, async (request, reply) => {
    if (!checkAuthRate(request)) {
      return reply.code(429).send({ error: 'Too many attempts. Try again later.' });
    }

    const email = request.body.email.toLowerCase().trim();
    const password = request.body.password;

    // Check if user already exists
    const { rows: existing } = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email],
    );
    if (existing.length > 0) {
      return reply.code(409).send({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if tenant exists (from free signup or Stripe checkout)
      const { rows: tenantRows } = await client.query<{ id: string }>(
        'SELECT id FROM tenants WHERE email = $1 LIMIT 1',
        [email],
      );

      let tenantId: string;

      if (tenantRows.length > 0) {
        tenantId = tenantRows[0].id;
      } else {
        // Create new free-tier tenant
        const { rows: newTenant } = await client.query<{ id: string }>(
          `INSERT INTO tenants (name, email, plan, memory_limit, agent_limit, team_limit, members_per_team_limit)
           VALUES ($1, $2, 'free', 100, 1, 0, 0) RETURNING id`,
          [email.split('@')[0], email],
        );
        tenantId = newTenant[0].id;
      }

      // Create user
      const { rows: userRows } = await client.query<{ id: string }>(
        `INSERT INTO users (tenant_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, email, passwordHash],
      );
      const userId = userRows[0].id;

      // Generate API key
      const rawKey = generateApiKey();
      const keyHash = hashApiKey(rawKey);
      await client.query(
        `INSERT INTO api_keys (tenant_id, key_hash, label) VALUES ($1, $2, 'Signup key')`,
        [tenantId, keyHash],
      );

      await client.query('COMMIT');

      const token = signJwt({ tenantId, userId, email });

      console.log(`[Auth] New user signup: ${email} (tenant: ${tenantId})`);

      // Queue drip email sequence (best-effort, don't block signup)
      enqueueDripSequence(tenantId, email, rawKey).catch((err) => {
        console.warn(`[Auth] Failed to queue drip emails for ${email}:`, err);
      });

      return reply.code(201).send({
        token,
        api_key: rawKey,
        tenant_id: tenantId,
        message: 'Save your API key — it cannot be recovered.',
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'An account with this email already exists.' });
      }
      throw err;
    } finally {
      client.release();
    }
  });

  /* ─── POST /v1/auth/login ────────────────────────────────────── */
  app.post<{
    Body: { email: string; password: string };
  }>('/v1/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    if (!checkAuthRate(request)) {
      return reply.code(429).send({ error: 'Too many attempts. Try again later.' });
    }

    const email = request.body.email.toLowerCase().trim();
    const password = request.body.password;

    const { rows } = await pool.query<{
      id: string; tenant_id: string; email: string; password_hash: string;
    }>(
      'SELECT id, tenant_id, email, password_hash FROM users WHERE email = $1',
      [email],
    );

    if (rows.length === 0) {
      // Constant-time comparison to prevent timing attacks
      await bcrypt.hash(password, BCRYPT_ROUNDS);
      return reply.code(401).send({ error: 'Invalid email or password.' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid email or password.' });
    }

    // Update last_login_at
    pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]).catch(() => {});

    // Fetch first API key for convenience
    const { rows: keyRows } = await pool.query<{ key_hash: string }>(
      'SELECT key_hash FROM api_keys WHERE tenant_id = $1 ORDER BY created_at LIMIT 1',
      [user.tenant_id],
    );

    const token = signJwt({ tenantId: user.tenant_id, userId: user.id, email: user.email });

    return reply.send({
      token,
      tenant_id: user.tenant_id,
      message: 'Login successful. Use your API key (from signup) for API calls, or this JWT for account management.',
    });
  });

  /* ─── GET /v1/auth/api-keys ──────────────────────────────────── */
  app.get('/v1/auth/api-keys', {
    preHandler: authenticateJwt,
  }, async (request, reply) => {
    const tenantId = request.tenantId;

    const { rows } = await pool.query<{
      id: string; label: string | null; created_at: string; last_used_at: string | null;
    }>(
      `SELECT id, label, created_at, last_used_at FROM api_keys
       WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    );

    return reply.send({
      api_keys: rows.map(r => ({
        id: r.id,
        label: r.label,
        created_at: r.created_at,
        last_used_at: r.last_used_at,
        // Show only hint of the hash — never the real key
        hint: 'smara_****' + r.id.slice(-4),
      })),
    });
  });

  /* ─── POST /v1/auth/api-keys ─────────────────────────────────── */
  app.post<{
    Body: { label?: string };
  }>('/v1/auth/api-keys', {
    preHandler: authenticateJwt,
    schema: {
      body: {
        type: 'object',
        properties: {
          label: { type: 'string', maxLength: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const tenantId = request.tenantId;
    const label = request.body?.label ?? 'Generated key';

    // Limit total keys per tenant to 10
    const { rows: [{ count }] } = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::TEXT AS count FROM api_keys WHERE tenant_id = $1',
      [tenantId],
    );
    if (parseInt(count, 10) >= 10) {
      return reply.code(400).send({ error: 'Maximum 10 API keys per account.' });
    }

    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);

    const { rows } = await pool.query<{ id: string; created_at: string }>(
      `INSERT INTO api_keys (tenant_id, key_hash, label) VALUES ($1, $2, $3) RETURNING id, created_at`,
      [tenantId, keyHash, label],
    );

    return reply.code(201).send({
      id: rows[0].id,
      api_key: rawKey,
      label,
      created_at: rows[0].created_at,
      message: 'Save this API key — it cannot be recovered.',
    });
  });

  /* ─── DELETE /v1/auth/api-keys/:keyId ────────────────────────── */
  app.delete<{
    Params: { keyId: string };
  }>('/v1/auth/api-keys/:keyId', {
    preHandler: authenticateJwt,
    schema: {
      params: {
        type: 'object',
        required: ['keyId'],
        properties: {
          keyId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const tenantId = request.tenantId;
    const keyId = request.params.keyId;

    // Ensure at least 1 key remains
    const { rows: [{ count }] } = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::TEXT AS count FROM api_keys WHERE tenant_id = $1',
      [tenantId],
    );
    if (parseInt(count, 10) <= 1) {
      return reply.code(400).send({ error: 'Cannot delete your last API key.' });
    }

    const { rowCount } = await pool.query(
      'DELETE FROM api_keys WHERE id = $1 AND tenant_id = $2',
      [keyId, tenantId],
    );

    if (!rowCount) {
      return reply.code(404).send({ error: 'API key not found.' });
    }

    return reply.code(204).send();
  });
}
