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
