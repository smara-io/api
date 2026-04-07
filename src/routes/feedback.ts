import { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';

interface FeedbackBody {
  type: 'feature' | 'bug' | 'general';
  title: string;
  description?: string;
  email?: string;
  metadata?: Record<string, unknown>;
}

interface VoteParams {
  id: string;
}

export async function feedbackRoutes(app: FastifyInstance) {
  // POST /v1/feedback — submit feature request, bug report, or general feedback
  app.post<{ Body: FeedbackBody }>('/v1/feedback', async (req, reply) => {
    const { type, title, description, email, metadata } = req.body;

    if (!type || !title) {
      return reply.code(400).send({ error: 'type and title are required' });
    }
    if (!['feature', 'bug', 'general'].includes(type)) {
      return reply.code(400).send({ error: 'type must be feature, bug, or general' });
    }
    if (title.length > 200) {
      return reply.code(400).send({ error: 'title must be under 200 characters' });
    }
    if (description && description.length > 5000) {
      return reply.code(400).send({ error: 'description must be under 5000 characters' });
    }

    // Optional: resolve tenant from API key if provided
    let tenantId: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const key = authHeader.slice(7);
      const { createHash } = await import('crypto');
      const keyHash = createHash('sha256').update(key).digest('hex');
      const { rows } = await pool.query(
        'SELECT tenant_id FROM api_keys WHERE key_hash = $1',
        [keyHash]
      );
      if (rows.length) tenantId = rows[0].tenant_id;
    }

    const { rows } = await pool.query(
      `INSERT INTO feedback (tenant_id, type, title, description, email, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, type, title, status, created_at`,
      [tenantId, type, title, description || null, email || null, JSON.stringify(metadata || {})]
    );

    return reply.code(201).send(rows[0]);
  });

  // GET /v1/feedback — list all feedback (public roadmap)
  app.get<{ Querystring: { type?: string; status?: string; limit?: string } }>(
    '/v1/feedback',
    async (req) => {
      const { type, status, limit } = req.query;
      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (type) {
        conditions.push(`type = $${idx++}`);
        params.push(type);
      }
      if (status) {
        conditions.push(`status = $${idx++}`);
        params.push(status);
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const lim = Math.min(parseInt(limit || '50', 10), 100);

      const { rows } = await pool.query(
        `SELECT id, type, title, description, status, votes, created_at
         FROM feedback ${where}
         ORDER BY votes DESC, created_at DESC
         LIMIT $${idx}`,
        [...params, lim]
      );

      return { feedback: rows, count: rows.length };
    }
  );

  // POST /v1/feedback/:id/vote — upvote a feature request
  app.post<{ Params: VoteParams }>('/v1/feedback/:id/vote', async (req, reply) => {
    const { id } = req.params;

    const { rows } = await pool.query(
      `UPDATE feedback SET votes = votes + 1 WHERE id = $1 RETURNING id, votes`,
      [id]
    );

    if (!rows.length) {
      return reply.code(404).send({ error: 'Feedback not found' });
    }

    return rows[0];
  });
}
