/**
 * OpenAI function-call proxy.
 * Accepts { name, arguments } from OpenAI tool_call format,
 * routes to internal Smara functions.
 *
 * POST /v1/openai/tool-call
 */

import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { storeMemory } from '../memory/store.js';
import { searchMemories, getContext } from '../memory/search.js';
import { pool } from '../db/pool.js';

interface ToolCallBody {
  name: string;
  arguments: Record<string, any>;
}

export async function openaiProxyRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ToolCallBody }>(
    '/v1/openai/tool-call',
    {
      preHandler: authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['name', 'arguments'],
          properties: {
            name: { type: 'string' },
            arguments: { type: 'object' },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, arguments: args } = request.body;
      const tenantId = (request as any).tenantId;

      switch (name) {
        case 'smara_store_memory': {
          const { user_id, fact, importance, source, namespace } = args;
          if (!user_id || !fact) {
            return reply.code(400).send({ error: 'user_id and fact are required' });
          }
          const result = await storeMemory(
            tenantId,
            user_id,
            fact,
            importance ?? 0.5,
            source ?? 'openai',
            namespace ?? 'default',
          );
          return reply.code(201).send(result);
        }

        case 'smara_search_memories': {
          const { user_id, q, limit, source, namespace } = args;
          if (!user_id || !q) {
            return reply.code(400).send({ error: 'user_id and q are required' });
          }
          const results = await searchMemories(
            tenantId,
            user_id,
            q,
            Math.min(limit ?? 10, 50),
            namespace ?? 'default',
            source,
          );
          return { results };
        }

        case 'smara_get_context': {
          const { user_id, q, top_n, namespace } = args;
          if (!user_id) {
            return reply.code(400).send({ error: 'user_id is required' });
          }
          const result = await getContext(
            tenantId,
            user_id,
            q,
            Math.min(top_n ?? 5, 20),
            namespace ?? 'default',
          );
          return result;
        }

        case 'smara_delete_memory': {
          const { memory_id } = args;
          if (!memory_id) {
            return reply.code(400).send({ error: 'memory_id is required' });
          }
          const { rowCount } = await pool.query(
            `UPDATE memories SET valid_until = NOW() WHERE id = $1 AND tenant_id = $2 AND valid_until IS NULL`,
            [memory_id, tenantId],
          );
          if (rowCount === 0) {
            return reply.code(404).send({ error: 'Memory not found' });
          }
          return reply.code(204).send();
        }

        case 'smara_get_usage': {
          const { rows: tenantRows } = await pool.query(
            'SELECT plan, memory_limit FROM tenants WHERE id = $1',
            [tenantId],
          );
          const { rows: countRows } = await pool.query(
            'SELECT COUNT(*)::int as used FROM memories WHERE tenant_id = $1 AND valid_until IS NULL',
            [tenantId],
          );
          const plan = tenantRows[0]?.plan ?? 'free';
          const limit = tenantRows[0]?.memory_limit ?? 10000;
          const used = countRows[0]?.used ?? 0;
          return { plan, memory_limit: limit, memories_used: used, memories_remaining: limit - used };
        }

        default:
          return reply.code(400).send({ error: `Unknown function: ${name}` });
      }
    },
  );
}
