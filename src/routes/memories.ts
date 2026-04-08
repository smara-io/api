import type { FastifyInstance } from 'fastify';
import { authenticate, resolveTeamAccess } from '../middleware/auth.js';
import { storeMemory, deleteMemory } from '../memory/store.js';
import { searchMemories, getContext } from '../memory/search.js';
import { pool } from '../db/pool.js';

export async function memoriesRoutes(app: FastifyInstance): Promise<void> {

  // POST /v1/memories — store a memory for a user
  app.post<{
    Body: { user_id: string; fact: string; importance?: number; source?: string; namespace?: string; team_id?: string; visibility?: string };
  }>('/v1/memories', {
    preHandler: authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['user_id', 'fact'],
        properties: {
          user_id: { type: 'string', minLength: 1 },
          fact: { type: 'string', minLength: 1, maxLength: 2000 },
          importance: { type: 'number', minimum: 0, maximum: 1 },
          source: { type: 'string', maxLength: 50 },
          namespace: { type: 'string', maxLength: 100 },
          team_id: { type: 'string', format: 'uuid' },
          visibility: { type: 'string', enum: ['private', 'team'] },
        },
      },
    },
  }, async (request, reply) => {
    const { user_id, fact, importance = 0.5, source = 'api', namespace = 'default', team_id, visibility } = request.body;

    // Validate team access if team_id provided
    if (team_id) {
      const access = await resolveTeamAccess(request.tenantId, user_id, team_id);
      if (!access) {
        return reply.code(403).send({ error: 'Not a member of this team' });
      }
      if (access.role === 'read_only') {
        return reply.code(403).send({ error: 'Read-only members cannot store team memories' });
      }
    }

    // ── Usage limit check ──────────────────────────────────────────────
    const { rows: [{ count }] } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM memories
       WHERE tenant_id = $1 AND valid_until IS NULL`,
      [request.tenantId]
    );
    const activeCount = parseInt(count, 10);

    if (activeCount >= request.tenantMemoryLimit) {
      return reply.code(402).send({
        error: 'Memory limit reached',
        plan: request.tenantPlan,
        limit: request.tenantMemoryLimit,
        used: activeCount,
        upgrade_url: 'https://smara.io/#pricing',
      });
    }

    const result = await storeMemory(request.tenantId, user_id, fact, importance, source, namespace, team_id, visibility);

    if (result.action === 'duplicate') {
      return reply.code(200).send({ action: 'duplicate', id: result.id });
    }

    return reply.code(201).send({
      action: result.action,
      id: result.id,
      source,
      namespace,
      ...(team_id && { team_id }),
      ...(result.replacedId && { replaced_id: result.replacedId }),
    });
  });

  // GET /v1/memories/search — semantic search
  app.get<{
    Querystring: { user_id: string; q: string; limit?: string; source?: string; namespace?: string; team_id?: string; include_team?: string };
  }>('/v1/memories/search', {
    preHandler: authenticate,
    schema: {
      querystring: {
        type: 'object',
        required: ['user_id', 'q'],
        properties: {
          user_id: { type: 'string' },
          q: { type: 'string', minLength: 1 },
          limit: { type: 'string' },
          source: { type: 'string' },
          namespace: { type: 'string' },
          team_id: { type: 'string' },
          include_team: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { user_id, q, limit, source, namespace = 'default', team_id, include_team } = request.query;
    const includeTeam = include_team === 'true' || include_team === '1';

    // Validate team membership if include_team is requested
    if (includeTeam && team_id) {
      const access = await resolveTeamAccess(request.tenantId, user_id, team_id);
      if (!access) {
        return reply.code(403).send({ error: 'Not a member of this team' });
      }
    }

    const results = await searchMemories(
      request.tenantId,
      user_id,
      q,
      Math.min(parseInt(limit ?? '10', 10), 50),
      source,
      namespace,
      team_id,
      includeTeam
    );
    return reply.send({ results });
  });

  // PATCH /v1/memories/:id — update a memory's visibility or importance
  app.patch<{
    Params: { id: string };
    Body: { visibility?: string; importance?: number };
  }>('/v1/memories/:id', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        properties: {
          visibility: { type: 'string', enum: ['private', 'team'] },
          importance: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { visibility, importance } = request.body;
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 3;

    if (visibility !== undefined) {
      updates.push(`visibility = $${paramIdx}`);
      // When switching to private, remove team_id; when switching to team, keep existing team_id
      if (visibility === 'private') {
        updates.push(`team_id = NULL`);
      }
      values.push(visibility);
      paramIdx++;
    }
    if (importance !== undefined) {
      updates.push(`importance = $${paramIdx}`);
      values.push(importance);
      paramIdx++;
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'Nothing to update. Provide visibility or importance.' });
    }

    const { rowCount, rows } = await pool.query<{ id: string; visibility: string; importance: number; team_id: string | null }>(
      `UPDATE memories SET ${updates.join(', ')}
       WHERE id = $1 AND tenant_id = $2 AND valid_until IS NULL
       RETURNING id, visibility, importance, team_id`,
      [request.params.id, request.tenantId, ...values]
    );

    if (!rowCount) {
      return reply.code(404).send({ error: 'Memory not found or already deleted' });
    }

    return reply.send(rows[0]);
  });

  // GET /v1/memories — list memories for a user (with visibility info)
  app.get<{
    Querystring: { user_id: string; limit?: string; offset?: string; namespace?: string; visibility?: string; team_id?: string };
  }>('/v1/memories', {
    preHandler: authenticate,
    schema: {
      querystring: {
        type: 'object',
        required: ['user_id'],
        properties: {
          user_id: { type: 'string' },
          limit: { type: 'string' },
          offset: { type: 'string' },
          namespace: { type: 'string' },
          visibility: { type: 'string', enum: ['private', 'team'] },
          team_id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { user_id, limit, offset, namespace = 'default', visibility, team_id } = request.query;
    const lim = Math.min(parseInt(limit ?? '20', 10), 100);
    const off = parseInt(offset ?? '0', 10);

    let where = `tenant_id = $1 AND valid_until IS NULL`;
    const values: unknown[] = [request.tenantId];
    let paramIdx = 2;

    // Filter by user's own memories + optionally team
    if (team_id) {
      where += ` AND ((user_id = $${paramIdx} AND team_id IS NULL) OR (team_id = $${paramIdx + 1} AND visibility = 'team'))`;
      values.push(user_id, team_id);
      paramIdx += 2;
    } else {
      where += ` AND user_id = $${paramIdx}`;
      values.push(user_id);
      paramIdx++;
    }

    where += ` AND namespace = $${paramIdx}`;
    values.push(namespace);
    paramIdx++;

    if (visibility) {
      where += ` AND visibility = $${paramIdx}`;
      values.push(visibility);
      paramIdx++;
    }

    const { rows } = await pool.query(
      `SELECT id, fact, visibility, team_id, importance, source, namespace, created_at
       FROM memories WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, lim, off]
    );

    return reply.send({ memories: rows, limit: lim, offset: off });
  });

  // DELETE /v1/memories/:id — expire a memory
  app.delete<{
    Params: { id: string };
    Querystring: { user_id: string };
  }>('/v1/memories/:id', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const deleted = await deleteMemory(request.tenantId, request.params.id);
    if (!deleted) {
      return reply.code(404).send({ error: 'Memory not found or already deleted' });
    }
    return reply.code(204).send();
  });

  // GET /v1/usage — check current plan and memory usage
  app.get('/v1/usage', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { rows: [{ count }] } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM memories
       WHERE tenant_id = $1 AND valid_until IS NULL`,
      [request.tenantId]
    );

    return reply.send({
      plan: request.tenantPlan,
      memory_limit: request.tenantMemoryLimit,
      memories_used: parseInt(count, 10),
      memories_remaining: Math.max(0, request.tenantMemoryLimit - parseInt(count, 10)),
    });
  });

  // GET /v1/users/:userId/context — top-N memories formatted as LLM context
  app.get<{
    Params: { userId: string };
    Querystring: { q?: string; top_n?: string; namespace?: string; team_id?: string; include_team?: string };
  }>('/v1/users/:userId/context', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', minLength: 1 },
          top_n: { type: 'string' },
          namespace: { type: 'string' },
          team_id: { type: 'string' },
          include_team: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { userId } = request.params;
    const { q, top_n, namespace = 'default', team_id, include_team } = request.query;
    const includeTeam = include_team === 'true' || include_team === '1';

    // Validate team membership if include_team is requested
    if (includeTeam && team_id) {
      const access = await resolveTeamAccess(request.tenantId, userId, team_id);
      if (!access) {
        return reply.code(403).send({ error: 'Not a member of this team' });
      }
    }

    const { memories, context } = await getContext(
      request.tenantId,
      userId,
      q,
      Math.min(parseInt(top_n ?? '5', 10), 20),
      namespace,
      team_id,
      includeTeam
    );

    return reply.send({ context, memories });
  });
}
