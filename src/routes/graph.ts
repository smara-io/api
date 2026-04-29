import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { pool } from '../db/pool.js';

export async function graphRoutes(app: FastifyInstance): Promise<void> {

  // POST /v1/graph/connect — create an edge between two memories
  app.post<{
    Body: {
      from_memory_id: string;
      to_memory_id: string;
      relationship_type: string;
      weight?: number;
      metadata?: Record<string, unknown>;
    };
  }>('/v1/graph/connect', {
    preHandler: authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['from_memory_id', 'to_memory_id', 'relationship_type'],
        properties: {
          from_memory_id: { type: 'string', format: 'uuid' },
          to_memory_id: { type: 'string', format: 'uuid' },
          relationship_type: { type: 'string', minLength: 1, maxLength: 100 },
          weight: { type: 'number', minimum: 0, maximum: 1 },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const { from_memory_id, to_memory_id, relationship_type, weight = 1.0, metadata } = request.body;

    if (from_memory_id === to_memory_id) {
      return reply.code(400).send({ error: 'Cannot create an edge from a memory to itself' });
    }

    // Verify both memories belong to the tenant
    const { rows: memoryRows } = await pool.query<{ id: string }>(
      `SELECT id FROM memories WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND valid_until IS NULL`,
      [[from_memory_id, to_memory_id], request.tenantId]
    );

    if (memoryRows.length < 2) {
      return reply.code(404).send({ error: 'One or both memories not found (must be active and belong to your tenant)' });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO memory_edges (from_memory_id, to_memory_id, relationship_type, weight, metadata)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, from_memory_id, to_memory_id, relationship_type, weight, metadata, created_at`,
        [from_memory_id, to_memory_id, relationship_type, weight, metadata ? JSON.stringify(metadata) : '{}']
      );

      return reply.code(201).send(rows[0]);
    } catch (err: any) {
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'Edge already exists between these memories with this relationship type' });
      }
      throw err;
    }
  });

  // GET /v1/graph/traverse/:memoryId — traverse graph from a memory node using recursive CTE
  app.get<{
    Params: { memoryId: string };
    Querystring: { depth?: string; relationship_type?: string };
  }>('/v1/graph/traverse/:memoryId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['memoryId'],
        properties: { memoryId: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        properties: {
          depth: { type: 'string' },
          relationship_type: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { memoryId } = request.params;
    const maxDepth = Math.min(parseInt(request.query.depth ?? '2', 10), 5);
    const { relationship_type } = request.query;

    // Verify root memory belongs to tenant
    const { rows: rootCheck } = await pool.query(
      `SELECT id FROM memories WHERE id = $1 AND tenant_id = $2 AND valid_until IS NULL`,
      [memoryId, request.tenantId]
    );
    if (rootCheck.length === 0) {
      return reply.code(404).send({ error: 'Memory not found' });
    }

    // Build the relationship type filter
    let relFilter = '';
    const params: unknown[] = [memoryId, maxDepth, request.tenantId];
    if (relationship_type) {
      relFilter = `AND e.relationship_type = $4`;
      params.push(relationship_type);
    }

    // Recursive CTE for graph traversal (bidirectional)
    const sql = `
      WITH RECURSIVE graph AS (
        -- Base case: direct connections from root
        SELECT
          CASE WHEN e.from_memory_id = $1 THEN e.to_memory_id ELSE e.from_memory_id END AS memory_id,
          e.id AS edge_id,
          e.relationship_type,
          e.weight,
          e.metadata AS edge_metadata,
          1 AS depth,
          ARRAY[$1::uuid] AS path
        FROM memory_edges e
        WHERE (e.from_memory_id = $1 OR e.to_memory_id = $1) ${relFilter}

        UNION ALL

        -- Recursive case: extend by one hop
        SELECT
          CASE WHEN e.from_memory_id = g.memory_id THEN e.to_memory_id ELSE e.from_memory_id END,
          e.id,
          e.relationship_type,
          e.weight,
          e.metadata,
          g.depth + 1,
          g.path || g.memory_id
        FROM memory_edges e
        JOIN graph g ON (e.from_memory_id = g.memory_id OR e.to_memory_id = g.memory_id)
        WHERE g.depth < $2
          AND NOT (CASE WHEN e.from_memory_id = g.memory_id THEN e.to_memory_id ELSE e.from_memory_id END = ANY(g.path))
          ${relFilter}
      )
      SELECT DISTINCT ON (g.memory_id)
        g.memory_id,
        g.edge_id,
        g.relationship_type,
        g.weight,
        g.edge_metadata,
        g.depth,
        m.fact,
        m.importance,
        m.source,
        m.namespace,
        m.created_at
      FROM graph g
      JOIN memories m ON m.id = g.memory_id
      WHERE m.tenant_id = $3 AND m.valid_until IS NULL
      ORDER BY g.memory_id, g.depth ASC
    `;

    const { rows } = await pool.query(sql, params);

    // Group by depth for structured response
    const nodes = rows.map(row => ({
      memory_id: row.memory_id,
      fact: row.fact,
      importance: row.importance,
      source: row.source,
      namespace: row.namespace,
      created_at: row.created_at,
      edge: {
        id: row.edge_id,
        relationship_type: row.relationship_type,
        weight: row.weight,
        metadata: row.edge_metadata,
      },
      depth: row.depth,
    }));

    return reply.send({
      root_memory_id: memoryId,
      max_depth: maxDepth,
      node_count: nodes.length,
      nodes,
    });
  });

  // GET /v1/graph/related/:memoryId — get directly related memories (depth=1, simpler query)
  app.get<{
    Params: { memoryId: string };
    Querystring: { relationship_type?: string; limit?: string };
  }>('/v1/graph/related/:memoryId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['memoryId'],
        properties: { memoryId: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        properties: {
          relationship_type: { type: 'string' },
          limit: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { memoryId } = request.params;
    const { relationship_type } = request.query;
    const lim = Math.min(parseInt(request.query.limit ?? '20', 10), 100);

    // Verify memory belongs to tenant
    const { rows: rootCheck } = await pool.query(
      `SELECT id FROM memories WHERE id = $1 AND tenant_id = $2 AND valid_until IS NULL`,
      [memoryId, request.tenantId]
    );
    if (rootCheck.length === 0) {
      return reply.code(404).send({ error: 'Memory not found' });
    }

    let sql = `
      SELECT
        e.id AS edge_id,
        e.relationship_type,
        e.weight,
        e.metadata AS edge_metadata,
        e.created_at AS edge_created_at,
        m.id AS memory_id,
        m.fact,
        m.importance,
        m.source,
        m.namespace,
        m.created_at
      FROM memory_edges e
      JOIN memories m ON m.id = CASE
        WHEN e.from_memory_id = $1 THEN e.to_memory_id
        ELSE e.from_memory_id
      END
      WHERE (e.from_memory_id = $1 OR e.to_memory_id = $1)
        AND m.tenant_id = $2
        AND m.valid_until IS NULL
    `;
    const params: unknown[] = [memoryId, request.tenantId];

    if (relationship_type) {
      sql += ` AND e.relationship_type = $3`;
      params.push(relationship_type);
    }

    sql += ` ORDER BY e.weight DESC LIMIT $${params.length + 1}`;
    params.push(lim);

    const { rows } = await pool.query(sql, params);

    const related = rows.map(row => ({
      memory_id: row.memory_id,
      fact: row.fact,
      importance: row.importance,
      source: row.source,
      namespace: row.namespace,
      created_at: row.created_at,
      edge: {
        id: row.edge_id,
        relationship_type: row.relationship_type,
        weight: row.weight,
        metadata: row.edge_metadata,
        created_at: row.edge_created_at,
      },
    }));

    return reply.send({ memory_id: memoryId, related });
  });

  // DELETE /v1/graph/edge/:edgeId — remove an edge
  app.delete<{
    Params: { edgeId: string };
  }>('/v1/graph/edge/:edgeId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['edgeId'],
        properties: { edgeId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const { edgeId } = request.params;

    // Only delete edges between memories owned by this tenant
    const { rowCount } = await pool.query(
      `DELETE FROM memory_edges e
       USING memories m
       WHERE e.id = $1
         AND (e.from_memory_id = m.id OR e.to_memory_id = m.id)
         AND m.tenant_id = $2`,
      [edgeId, request.tenantId]
    );

    if ((rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Edge not found' });
    }

    return reply.code(204).send();
  });
}
