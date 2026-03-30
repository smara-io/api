import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { storeMemory, deleteMemory } from '../memory/store.js';
import { searchMemories, getContext } from '../memory/search.js';
import { pool } from '../db/pool.js';

export async function memoriesRoutes(app: FastifyInstance): Promise<void> {

  // POST /v1/memories — store a memory for a user
  app.post<{
    Body: { user_id: string; fact: string; importance?: number };
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
        },
      },
    },
  }, async (request, reply) => {
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

    const { user_id, fact, importance = 0.5 } = request.body;
    const result = await storeMemory(request.tenantId, user_id, fact, importance);

    if (result.action === 'duplicate') {
      return reply.code(200).send({ action: 'duplicate', id: result.id });
    }

    return reply.code(201).send({
      action: result.action,
      id: result.id,
      ...(result.replacedId && { replaced_id: result.replacedId }),
    });
  });

  // GET /v1/memories/search — semantic search
  app.get<{
    Querystring: { user_id: string; q: string; limit?: string };
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
        },
      },
    },
  }, async (request, reply) => {
    const { user_id, q, limit } = request.query;
    const results = await searchMemories(
      request.tenantId,
      user_id,
      q,
      Math.min(parseInt(limit ?? '10', 10), 50)
    );
    return reply.send({ results });
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
    Querystring: { q: string; top_n?: string };
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
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1 },
          top_n: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { userId } = request.params;
    const { q, top_n } = request.query;

    const { memories, context } = await getContext(
      request.tenantId,
      userId,
      q,
      Math.min(parseInt(top_n ?? '5', 10), 20)
    );

    return reply.send({ context, memories });
  });
}
