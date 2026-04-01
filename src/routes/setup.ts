/**
 * One-time setup endpoint.
 * Creates the first tenant + API key.
 * Locked behind SETUP_SECRET env var.
 * Returns 410 Gone after first tenant exists.
 */

import { createHash, randomBytes } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';

function generateApiKey(): string {
  return `smara_${randomBytes(32).toString('hex')}`;
}

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  // Admin: create a new API key for an existing tenant (secured by SETUP_SECRET)
  app.post<{ Body: { label?: string } }>(
    '/admin/keys',
    async (request, reply) => {
      const secret = request.headers['x-setup-secret'] as string;
      if (!secret || secret !== process.env.SETUP_SECRET) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const { rows } = await pool.query('SELECT id, name FROM tenants LIMIT 1');
      if (rows.length === 0) return reply.code(404).send({ error: 'No tenants exist' });

      const tenantId = rows[0].id;
      const rawKey = generateApiKey();
      const keyHash = hashKey(rawKey);
      const label = request.body?.label ?? 'Admin-generated key';

      await pool.query(
        'INSERT INTO api_keys (tenant_id, key_hash, label) VALUES ($1, $2, $3)',
        [tenantId, keyHash, label],
      );
      return reply.code(201).send({ tenant_id: tenantId, tenant_name: rows[0].name, api_key: rawKey, label });
    },
  );

  // Admin: check tenant + memory stats (secured by SETUP_SECRET)
  app.get('/admin/stats', async (request, reply) => {
    const secret = request.headers['x-setup-secret'] as string;
    if (!secret || secret !== process.env.SETUP_SECRET) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const tenants = await pool.query('SELECT id, name, plan, memory_limit FROM tenants');
    const mems = await pool.query('SELECT COUNT(*) as count FROM memories WHERE valid_until IS NULL');
    const keys = await pool.query('SELECT tenant_id, label, created_at FROM api_keys ORDER BY created_at');
    return { tenants: tenants.rows, active_memories: Number(mems.rows[0].count), api_keys: keys.rows };
  });

  app.post<{ Body: { tenant_name?: string } }>(
    '/setup',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            tenant_name: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      // Only allow if no tenants exist yet
      const { rows } = await pool.query('SELECT id FROM tenants LIMIT 1');
      if (rows.length > 0) {
        return reply.code(410).send({ error: 'Already set up. This endpoint is disabled.' });
      }

      const tenantName = request.body.tenant_name ?? 'Default';
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const { rows: tenantRows } = await client.query<{ id: string }>(
          `INSERT INTO tenants (name) VALUES ($1) RETURNING id`,
          [tenantName]
        );
        const tenantId = tenantRows[0].id;

        const rawKey = generateApiKey();
        const keyHash = hashKey(rawKey);

        await client.query(
          `INSERT INTO api_keys (tenant_id, key_hash, label) VALUES ($1, $2, 'Initial key')`,
          [tenantId, keyHash]
        );

        await client.query('COMMIT');

        return reply.code(201).send({
          tenant_id: tenantId,
          tenant_name: tenantName,
          api_key: rawKey,
          note: 'Save this API key — it cannot be recovered.',
        });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
  );
}
