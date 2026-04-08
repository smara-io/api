import { createHash } from 'crypto';
import { pool } from '../db/pool.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    tenantPlan: string;
    tenantMemoryLimit: number;
  }
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const rawKey = authHeader.slice(7);
  const keyHash = hashKey(rawKey);

  const { rows } = await pool.query<{
    tenant_id: string;
    key_id: string;
    plan: string;
    memory_limit: number;
  }>(
    `SELECT a.tenant_id, a.id AS key_id, t.plan, t.memory_limit
     FROM api_keys a
     JOIN tenants t ON t.id = a.tenant_id
     WHERE a.key_hash = $1`,
    [keyHash]
  );

  if (rows.length === 0) {
    reply.code(401).send({ error: 'Invalid API key' });
    return;
  }

  request.tenantId = rows[0].tenant_id;
  request.tenantPlan = rows[0].plan;
  request.tenantMemoryLimit = rows[0].memory_limit;

  // Update last_used_at in background
  pool.query(
    `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
    [rows[0].key_id]
  ).catch(() => {/* non-critical */});
}

/**
 * Check if a user is a member of a team that belongs to the given tenant.
 * Returns their role or null if not a member / team doesn't belong to tenant.
 */
export async function resolveTeamAccess(
  tenantId: string,
  userId: string,
  teamId: string
): Promise<{ role: 'admin' | 'member' | 'read_only' } | null> {
  const { rows } = await pool.query<{ role: 'admin' | 'member' | 'read_only' }>(
    `SELECT tm.role
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.team_id = $1
       AND tm.user_id = $2
       AND t.tenant_id = $3`,
    [teamId, userId, tenantId]
  );
  if (rows.length === 0) return null;
  return { role: rows[0].role };
}
