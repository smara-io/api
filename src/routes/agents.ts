import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { pool } from '../db/pool.js';

export async function agentsRoutes(app: FastifyInstance): Promise<void> {

  // POST /v1/agents — create an agent
  app.post<{
    Body: { name: string; description?: string; owner_id: string; model?: string; system_prompt?: string };
  }>('/v1/agents', {
    preHandler: authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['name', 'owner_id'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 2000 },
          owner_id: { type: 'string', minLength: 1 },
          model: { type: 'string', maxLength: 200 },
          system_prompt: { type: 'string', maxLength: 10000 },
        },
      },
    },
  }, async (request, reply) => {
    const { name, description, owner_id, model, system_prompt } = request.body;

    // Check agent_limit
    const { rows: [tenant] } = await pool.query<{ agent_limit: number }>(
      `SELECT agent_limit FROM tenants WHERE id = $1`,
      [request.tenantId]
    );
    const { rows: [{ count }] } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM agents WHERE tenant_id = $1`,
      [request.tenantId]
    );
    if (parseInt(count, 10) >= tenant.agent_limit) {
      return reply.code(402).send({
        error: 'Agent limit reached',
        limit: tenant.agent_limit,
        used: parseInt(count, 10),
      });
    }

    const { rows } = await pool.query<{
      id: string; name: string; description: string | null; owner_id: string;
      model: string | null; system_prompt: string | null; created_at: string;
    }>(
      `INSERT INTO agents (tenant_id, name, description, owner_id, model, system_prompt)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, owner_id, model, system_prompt, created_at`,
      [request.tenantId, name, description ?? null, owner_id, model ?? null, system_prompt ?? null]
    );

    return reply.code(201).send(rows[0]);
  });

  // GET /v1/agents — list tenant's agents
  app.get<{
    Querystring: { owner_id?: string };
  }>('/v1/agents', {
    preHandler: authenticate,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          owner_id: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { owner_id } = request.query;
    let sql = `SELECT id, name, description, owner_id, model, system_prompt, created_at, updated_at
               FROM agents WHERE tenant_id = $1`;
    const params: unknown[] = [request.tenantId];

    if (owner_id) {
      sql += ` AND owner_id = $2`;
      params.push(owner_id);
    }

    sql += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(sql, params);
    return reply.send({ agents: rows });
  });

  // GET /v1/agents/:agentId — get agent details
  app.get<{
    Params: { agentId: string };
  }>('/v1/agents/:agentId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['agentId'],
        properties: { agentId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const { agentId } = request.params;

    const { rows: agentRows } = await pool.query(
      `SELECT id, name, description, owner_id, model, system_prompt, created_at, updated_at
       FROM agents WHERE id = $1 AND tenant_id = $2`,
      [agentId, request.tenantId]
    );
    if (agentRows.length === 0) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    // Include skills
    const { rows: skills } = await pool.query(
      `SELECT s.id, s.name, s.description, s.category, s.schema, ags.config
       FROM agent_skills ags
       JOIN skills s ON s.id = ags.skill_id
       WHERE ags.agent_id = $1`,
      [agentId]
    );

    return reply.send({ ...agentRows[0], skills });
  });

  // PATCH /v1/agents/:agentId — update agent
  app.patch<{
    Params: { agentId: string };
    Body: { name?: string; description?: string; model?: string; system_prompt?: string };
  }>('/v1/agents/:agentId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['agentId'],
        properties: { agentId: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 2000 },
          model: { type: 'string', maxLength: 200 },
          system_prompt: { type: 'string', maxLength: 10000 },
        },
      },
    },
  }, async (request, reply) => {
    const { agentId } = request.params;
    const { name, description, model, system_prompt } = request.body;

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (name !== undefined) { setClauses.push(`name = $${paramIdx++}`); params.push(name); }
    if (description !== undefined) { setClauses.push(`description = $${paramIdx++}`); params.push(description); }
    if (model !== undefined) { setClauses.push(`model = $${paramIdx++}`); params.push(model); }
    if (system_prompt !== undefined) { setClauses.push(`system_prompt = $${paramIdx++}`); params.push(system_prompt); }

    if (setClauses.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);

    params.push(agentId, request.tenantId);
    const { rows } = await pool.query(
      `UPDATE agents SET ${setClauses.join(', ')} WHERE id = $${paramIdx++} AND tenant_id = $${paramIdx}
       RETURNING id, name, description, owner_id, model, system_prompt, created_at, updated_at`,
      params
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    return reply.send(rows[0]);
  });

  // DELETE /v1/agents/:agentId — delete agent
  app.delete<{
    Params: { agentId: string };
  }>('/v1/agents/:agentId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['agentId'],
        properties: { agentId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const { agentId } = request.params;

    const { rowCount } = await pool.query(
      `DELETE FROM agents WHERE id = $1 AND tenant_id = $2`,
      [agentId, request.tenantId]
    );
    if ((rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    return reply.code(204).send();
  });

  // ── Skills CRUD ───────────────────────────────────────────────────────────

  // POST /v1/skills — create a skill
  app.post<{
    Body: { name: string; description?: string; category?: string; schema?: Record<string, unknown> };
  }>('/v1/skills', {
    preHandler: authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 2000 },
          category: { type: 'string', maxLength: 100 },
          schema: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const { name, description, category, schema: skillSchema } = request.body;

    // Check custom_skill_limit for non-built-in skills
    const { rows: [tenant] } = await pool.query<{ custom_skill_limit: number }>(
      `SELECT custom_skill_limit FROM tenants WHERE id = $1`,
      [request.tenantId]
    );
    const { rows: [{ count }] } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM skills WHERE tenant_id = $1`,
      [request.tenantId]
    );
    if (parseInt(count, 10) >= tenant.custom_skill_limit) {
      return reply.code(402).send({
        error: 'Custom skill limit reached',
        limit: tenant.custom_skill_limit,
        used: parseInt(count, 10),
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO skills (tenant_id, name, description, category, schema)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, category, schema, created_at`,
      [request.tenantId, name, description ?? null, category ?? null, skillSchema ? JSON.stringify(skillSchema) : null]
    );

    return reply.code(201).send(rows[0]);
  });

  // GET /v1/skills — list skills (tenant-scoped + built-in)
  app.get<{
    Querystring: { category?: string };
  }>('/v1/skills', {
    preHandler: authenticate,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          category: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { category } = request.query;
    let sql = `SELECT id, name, description, category, schema, created_at
               FROM skills WHERE (tenant_id = $1 OR tenant_id IS NULL)`;
    const params: unknown[] = [request.tenantId];

    if (category) {
      sql += ` AND category = $2`;
      params.push(category);
    }

    sql += ` ORDER BY created_at`;

    const { rows } = await pool.query(sql, params);
    return reply.send({ skills: rows });
  });

  // GET /v1/skills/:skillId — get skill details
  app.get<{
    Params: { skillId: string };
  }>('/v1/skills/:skillId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['skillId'],
        properties: { skillId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const { skillId } = request.params;

    const { rows } = await pool.query(
      `SELECT id, name, description, category, schema, created_at
       FROM skills WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)`,
      [skillId, request.tenantId]
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Skill not found' });
    }

    return reply.send(rows[0]);
  });

  // PATCH /v1/skills/:skillId — update a skill
  app.patch<{
    Params: { skillId: string };
    Body: { name?: string; description?: string; category?: string; schema?: Record<string, unknown> };
  }>('/v1/skills/:skillId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['skillId'],
        properties: { skillId: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 2000 },
          category: { type: 'string', maxLength: 100 },
          schema: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const { skillId } = request.params;
    const { name, description, category, schema: skillSchema } = request.body;

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (name !== undefined) { setClauses.push(`name = $${paramIdx++}`); params.push(name); }
    if (description !== undefined) { setClauses.push(`description = $${paramIdx++}`); params.push(description); }
    if (category !== undefined) { setClauses.push(`category = $${paramIdx++}`); params.push(category); }
    if (skillSchema !== undefined) { setClauses.push(`schema = $${paramIdx++}`); params.push(JSON.stringify(skillSchema)); }

    if (setClauses.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    params.push(skillId, request.tenantId);
    const { rows } = await pool.query(
      `UPDATE skills SET ${setClauses.join(', ')} WHERE id = $${paramIdx++} AND tenant_id = $${paramIdx}
       RETURNING id, name, description, category, schema, created_at`,
      params
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Skill not found or is a built-in skill' });
    }

    return reply.send(rows[0]);
  });

  // DELETE /v1/skills/:skillId — delete a skill
  app.delete<{
    Params: { skillId: string };
  }>('/v1/skills/:skillId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['skillId'],
        properties: { skillId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const { skillId } = request.params;

    const { rowCount } = await pool.query(
      `DELETE FROM skills WHERE id = $1 AND tenant_id = $2`,
      [skillId, request.tenantId]
    );
    if ((rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Skill not found or is a built-in skill' });
    }

    return reply.code(204).send();
  });

  // ── Agent-Skill Assignments ───────────────────────────────────────────────

  // POST /v1/agents/:agentId/skills — attach a skill to an agent
  app.post<{
    Params: { agentId: string };
    Body: { skill_id: string; config?: Record<string, unknown> };
  }>('/v1/agents/:agentId/skills', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['agentId'],
        properties: { agentId: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['skill_id'],
        properties: {
          skill_id: { type: 'string', format: 'uuid' },
          config: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const { agentId } = request.params;
    const { skill_id, config } = request.body;

    // Verify agent belongs to tenant
    const { rows: agentRows } = await pool.query(
      `SELECT id FROM agents WHERE id = $1 AND tenant_id = $2`,
      [agentId, request.tenantId]
    );
    if (agentRows.length === 0) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    // Verify skill is accessible (tenant-owned or built-in)
    const { rows: skillRows } = await pool.query(
      `SELECT id FROM skills WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)`,
      [skill_id, request.tenantId]
    );
    if (skillRows.length === 0) {
      return reply.code(404).send({ error: 'Skill not found' });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO agent_skills (agent_id, skill_id, config)
         VALUES ($1, $2, $3)
         RETURNING agent_id, skill_id, config`,
        [agentId, skill_id, config ? JSON.stringify(config) : '{}']
      );
      return reply.code(201).send(rows[0]);
    } catch (err: any) {
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'Skill already attached to this agent' });
      }
      throw err;
    }
  });

  // GET /v1/agents/:agentId/skills — list skills attached to an agent
  app.get<{
    Params: { agentId: string };
  }>('/v1/agents/:agentId/skills', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['agentId'],
        properties: { agentId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const { agentId } = request.params;

    // Verify agent belongs to tenant
    const { rows: agentRows } = await pool.query(
      `SELECT id FROM agents WHERE id = $1 AND tenant_id = $2`,
      [agentId, request.tenantId]
    );
    if (agentRows.length === 0) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.description, s.category, s.schema, ags.config
       FROM agent_skills ags
       JOIN skills s ON s.id = ags.skill_id
       WHERE ags.agent_id = $1
       ORDER BY s.name`,
      [agentId]
    );

    return reply.send({ skills: rows });
  });

  // PATCH /v1/agents/:agentId/skills/:skillId — update agent-skill config
  app.patch<{
    Params: { agentId: string; skillId: string };
    Body: { config: Record<string, unknown> };
  }>('/v1/agents/:agentId/skills/:skillId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['agentId', 'skillId'],
        properties: {
          agentId: { type: 'string', format: 'uuid' },
          skillId: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['config'],
        properties: {
          config: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const { agentId, skillId } = request.params;
    const { config } = request.body;

    // Verify agent belongs to tenant
    const { rows: agentRows } = await pool.query(
      `SELECT id FROM agents WHERE id = $1 AND tenant_id = $2`,
      [agentId, request.tenantId]
    );
    if (agentRows.length === 0) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    const { rows } = await pool.query(
      `UPDATE agent_skills SET config = $1
       WHERE agent_id = $2 AND skill_id = $3
       RETURNING agent_id, skill_id, config`,
      [JSON.stringify(config), agentId, skillId]
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Agent-skill assignment not found' });
    }

    return reply.send(rows[0]);
  });

  // DELETE /v1/agents/:agentId/skills/:skillId — detach a skill from an agent
  app.delete<{
    Params: { agentId: string; skillId: string };
  }>('/v1/agents/:agentId/skills/:skillId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['agentId', 'skillId'],
        properties: {
          agentId: { type: 'string', format: 'uuid' },
          skillId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { agentId, skillId } = request.params;

    // Verify agent belongs to tenant
    const { rows: agentRows } = await pool.query(
      `SELECT id FROM agents WHERE id = $1 AND tenant_id = $2`,
      [agentId, request.tenantId]
    );
    if (agentRows.length === 0) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    const { rowCount } = await pool.query(
      `DELETE FROM agent_skills WHERE agent_id = $1 AND skill_id = $2`,
      [agentId, skillId]
    );
    if ((rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Agent-skill assignment not found' });
    }

    return reply.code(204).send();
  });

  // ── Agent-scoped memories ─────────────────────────────────────────────────

  // POST /v1/agents/:agentId/memories — store a memory scoped to an agent
  app.post<{
    Params: { agentId: string };
    Body: { user_id: string; fact: string; importance?: number; namespace?: string };
  }>('/v1/agents/:agentId/memories', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['agentId'],
        properties: { agentId: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['user_id', 'fact'],
        properties: {
          user_id: { type: 'string', minLength: 1 },
          fact: { type: 'string', minLength: 1, maxLength: 2000 },
          importance: { type: 'number', minimum: 0, maximum: 1 },
          namespace: { type: 'string', maxLength: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const { agentId } = request.params;
    const { user_id, fact, importance = 0.5, namespace = 'default' } = request.body;

    // Verify agent belongs to tenant
    const { rows: agentRows } = await pool.query(
      `SELECT id FROM agents WHERE id = $1 AND tenant_id = $2`,
      [agentId, request.tenantId]
    );
    if (agentRows.length === 0) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    // Import store dynamically to use existing storeMemory with agent source
    const { storeMemory } = await import('../memory/store.js');
    const result = await storeMemory(
      request.tenantId,
      user_id,
      fact,
      importance,
      `agent:${agentId}`,
      namespace
    );

    if (result.action === 'duplicate') {
      return reply.code(200).send({ action: 'duplicate', id: result.id });
    }

    return reply.code(201).send({
      action: result.action,
      id: result.id,
      agent_id: agentId,
      namespace,
      ...(result.replacedId && { replaced_id: result.replacedId }),
    });
  });

  // GET /v1/agents/:agentId/memories — search memories scoped to an agent
  app.get<{
    Params: { agentId: string };
    Querystring: { user_id: string; q?: string; limit?: string; namespace?: string };
  }>('/v1/agents/:agentId/memories', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['agentId'],
        properties: { agentId: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        required: ['user_id'],
        properties: {
          user_id: { type: 'string' },
          q: { type: 'string' },
          limit: { type: 'string' },
          namespace: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { agentId } = request.params;
    const { user_id, q, limit, namespace = 'default' } = request.query;

    // Verify agent belongs to tenant
    const { rows: agentRows } = await pool.query(
      `SELECT id FROM agents WHERE id = $1 AND tenant_id = $2`,
      [agentId, request.tenantId]
    );
    if (agentRows.length === 0) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    const lim = Math.min(parseInt(limit ?? '10', 10), 50);

    if (q) {
      const { searchMemories } = await import('../memory/search.js');
      const results = await searchMemories(
        request.tenantId,
        user_id,
        q,
        lim,
        `agent:${agentId}`,
        namespace
      );
      return reply.send({ results });
    }

    // No query — list recent agent-scoped memories
    const { rows } = await pool.query(
      `SELECT id, fact, importance, source, namespace, created_at
       FROM memories
       WHERE tenant_id = $1 AND user_id = $2 AND source = $3 AND namespace = $4 AND valid_until IS NULL
       ORDER BY created_at DESC
       LIMIT $5`,
      [request.tenantId, user_id, `agent:${agentId}`, namespace, lim]
    );

    return reply.send({ memories: rows });
  });
}
