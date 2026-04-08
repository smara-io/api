import { randomBytes } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { authenticate, resolveTeamAccess } from '../middleware/auth.js';
import { pool } from '../db/pool.js';

export async function teamsRoutes(app: FastifyInstance): Promise<void> {

  // POST /v1/teams — create a team
  app.post<{
    Body: { name: string; slug: string; user_id: string; email?: string };
  }>('/v1/teams', {
    preHandler: authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['name', 'slug', 'user_id'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          slug: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9-]+$' },
          user_id: { type: 'string', minLength: 1 },
          email: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { name, slug, user_id, email } = request.body;

    // Check team_limit
    const { rows: [tenant] } = await pool.query<{ team_limit: number }>(
      `SELECT team_limit FROM tenants WHERE id = $1`,
      [request.tenantId]
    );
    const { rows: [{ count }] } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM teams WHERE tenant_id = $1`,
      [request.tenantId]
    );
    if (parseInt(count, 10) >= tenant.team_limit) {
      return reply.code(402).send({
        error: 'Team limit reached',
        limit: tenant.team_limit,
        used: parseInt(count, 10),
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: teamRows } = await client.query<{ id: string; created_at: string }>(
        `INSERT INTO teams (tenant_id, name, slug) VALUES ($1, $2, $3) RETURNING id, created_at`,
        [request.tenantId, name, slug]
      );
      const team = teamRows[0];

      // Creator becomes admin
      await client.query(
        `INSERT INTO team_members (team_id, user_id, email, role) VALUES ($1, $2, $3, 'admin')`,
        [team.id, user_id, email ?? null]
      );

      await client.query('COMMIT');

      return reply.code(201).send({
        id: team.id,
        tenant_id: request.tenantId,
        name,
        slug,
        created_at: team.created_at,
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.code === '23505' && err.constraint?.includes('slug')) {
        return reply.code(409).send({ error: 'Team slug already exists for this tenant' });
      }
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /v1/teams — list tenant's teams
  app.get('/v1/teams', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.slug, t.created_at,
              (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id)::INTEGER AS member_count
       FROM teams t
       WHERE t.tenant_id = $1
       ORDER BY t.created_at`,
      [request.tenantId]
    );
    return reply.send({ teams: rows });
  });

  // GET /v1/teams/:teamId — team details + members
  app.get<{
    Params: { teamId: string };
  }>('/v1/teams/:teamId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['teamId'],
        properties: { teamId: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const { teamId } = request.params;
    const { rows: teamRows } = await pool.query(
      `SELECT id, name, slug, created_at FROM teams WHERE id = $1 AND tenant_id = $2`,
      [teamId, request.tenantId]
    );
    if (teamRows.length === 0) {
      return reply.code(404).send({ error: 'Team not found' });
    }

    const { rows: members } = await pool.query(
      `SELECT id, user_id, email, role, invited_by, joined_at
       FROM team_members WHERE team_id = $1 ORDER BY joined_at`,
      [teamId]
    );

    return reply.send({ ...teamRows[0], members });
  });

  // PATCH /v1/teams/:teamId — update team name/slug (admin only)
  app.patch<{
    Params: { teamId: string };
    Body: { name?: string; slug?: string; user_id: string };
  }>('/v1/teams/:teamId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['teamId'],
        properties: { teamId: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['user_id'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          slug: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9-]+$' },
          user_id: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { teamId } = request.params;
    const { name, slug, user_id } = request.body;

    const access = await resolveTeamAccess(request.tenantId, user_id, teamId);
    if (!access || access.role !== 'admin') {
      return reply.code(403).send({ error: 'Only team admins can update team settings' });
    }

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (name) {
      setClauses.push(`name = $${paramIdx++}`);
      params.push(name);
    }
    if (slug) {
      setClauses.push(`slug = $${paramIdx++}`);
      params.push(slug);
    }

    if (setClauses.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    params.push(teamId, request.tenantId);
    const { rows } = await pool.query(
      `UPDATE teams SET ${setClauses.join(', ')} WHERE id = $${paramIdx++} AND tenant_id = $${paramIdx} RETURNING id, name, slug, created_at`,
      params
    );

    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Team not found' });
    }

    return reply.send(rows[0]);
  });

  // DELETE /v1/teams/:teamId — delete team (admin only)
  app.delete<{
    Params: { teamId: string };
    Querystring: { user_id: string };
  }>('/v1/teams/:teamId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['teamId'],
        properties: { teamId: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        required: ['user_id'],
        properties: { user_id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { teamId } = request.params;
    const { user_id } = request.query;

    const access = await resolveTeamAccess(request.tenantId, user_id, teamId);
    if (!access || access.role !== 'admin') {
      return reply.code(403).send({ error: 'Only team admins can delete teams' });
    }

    const { rowCount } = await pool.query(
      `DELETE FROM teams WHERE id = $1 AND tenant_id = $2`,
      [teamId, request.tenantId]
    );
    if ((rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Team not found' });
    }

    return reply.code(204).send();
  });

  // POST /v1/teams/:teamId/members — add member
  app.post<{
    Params: { teamId: string };
    Body: { user_id: string; email?: string; role?: string; added_by: string };
  }>('/v1/teams/:teamId/members', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['teamId'],
        properties: { teamId: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['user_id', 'added_by'],
        properties: {
          user_id: { type: 'string', minLength: 1 },
          email: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'member', 'read_only'] },
          added_by: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { teamId } = request.params;
    const { user_id, email, role = 'member', added_by } = request.body;

    // Check caller is admin
    const access = await resolveTeamAccess(request.tenantId, added_by, teamId);
    if (!access || access.role !== 'admin') {
      return reply.code(403).send({ error: 'Only team admins can add members' });
    }

    // Check members_per_team_limit
    const { rows: [tenant] } = await pool.query<{ members_per_team_limit: number }>(
      `SELECT members_per_team_limit FROM tenants WHERE id = $1`,
      [request.tenantId]
    );
    const { rows: [{ count }] } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM team_members WHERE team_id = $1`,
      [teamId]
    );
    if (parseInt(count, 10) >= tenant.members_per_team_limit) {
      return reply.code(402).send({
        error: 'Team member limit reached',
        limit: tenant.members_per_team_limit,
        used: parseInt(count, 10),
      });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO team_members (team_id, user_id, email, role, invited_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, email, role, joined_at`,
        [teamId, user_id, email ?? null, role, added_by]
      );
      return reply.code(201).send(rows[0]);
    } catch (err: any) {
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'User is already a member of this team' });
      }
      throw err;
    }
  });

  // PATCH /v1/teams/:teamId/members/:userId — change role
  app.patch<{
    Params: { teamId: string; userId: string };
    Body: { role: string; changed_by: string };
  }>('/v1/teams/:teamId/members/:userId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['teamId', 'userId'],
        properties: {
          teamId: { type: 'string', format: 'uuid' },
          userId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['role', 'changed_by'],
        properties: {
          role: { type: 'string', enum: ['admin', 'member', 'read_only'] },
          changed_by: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { teamId, userId } = request.params;
    const { role, changed_by } = request.body;

    const access = await resolveTeamAccess(request.tenantId, changed_by, teamId);
    if (!access || access.role !== 'admin') {
      return reply.code(403).send({ error: 'Only team admins can change member roles' });
    }

    const { rows } = await pool.query(
      `UPDATE team_members SET role = $1 WHERE team_id = $2 AND user_id = $3
       RETURNING id, user_id, email, role, joined_at`,
      [role, teamId, userId]
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'Member not found' });
    }

    return reply.send(rows[0]);
  });

  // DELETE /v1/teams/:teamId/members/:userId — remove member
  app.delete<{
    Params: { teamId: string; userId: string };
    Querystring: { removed_by: string };
  }>('/v1/teams/:teamId/members/:userId', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['teamId', 'userId'],
        properties: {
          teamId: { type: 'string', format: 'uuid' },
          userId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        required: ['removed_by'],
        properties: { removed_by: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { teamId, userId } = request.params;
    const { removed_by } = request.query;

    // Allow self-removal or admin removal
    if (removed_by !== userId) {
      const access = await resolveTeamAccess(request.tenantId, removed_by, teamId);
      if (!access || access.role !== 'admin') {
        return reply.code(403).send({ error: 'Only team admins can remove other members' });
      }
    }

    const { rowCount } = await pool.query(
      `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, userId]
    );
    if ((rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: 'Member not found' });
    }

    return reply.code(204).send();
  });

  // POST /v1/teams/:teamId/invitations — create invitation
  app.post<{
    Params: { teamId: string };
    Body: { email: string; role?: string; invited_by: string };
  }>('/v1/teams/:teamId/invitations', {
    preHandler: authenticate,
    schema: {
      params: {
        type: 'object',
        required: ['teamId'],
        properties: { teamId: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['email', 'invited_by'],
        properties: {
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['admin', 'member', 'read_only'] },
          invited_by: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { teamId } = request.params;
    const { email, role = 'member', invited_by } = request.body;

    const access = await resolveTeamAccess(request.tenantId, invited_by, teamId);
    if (!access || access.role !== 'admin') {
      return reply.code(403).send({ error: 'Only team admins can send invitations' });
    }

    // Verify team belongs to tenant
    const { rows: teamRows } = await pool.query(
      `SELECT id FROM teams WHERE id = $1 AND tenant_id = $2`,
      [teamId, request.tenantId]
    );
    if (teamRows.length === 0) {
      return reply.code(404).send({ error: 'Team not found' });
    }

    const token = randomBytes(32).toString('hex');

    const { rows } = await pool.query(
      `INSERT INTO team_invitations (team_id, email, role, token)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, role, token, expires_at, created_at`,
      [teamId, email.toLowerCase().trim(), role, token]
    );

    return reply.code(201).send(rows[0]);
  });

  // POST /v1/invitations/:token/accept — accept invitation (public, no auth)
  app.post<{
    Params: { token: string };
    Body: { user_id: string; email?: string };
  }>('/v1/invitations/:token/accept', {
    schema: {
      params: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', minLength: 1 } },
      },
      body: {
        type: 'object',
        required: ['user_id'],
        properties: {
          user_id: { type: 'string', minLength: 1 },
          email: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { token } = request.params;
    const { user_id, email } = request.body;

    const { rows: invRows } = await pool.query<{
      id: string;
      team_id: string;
      email: string;
      role: string;
      expires_at: Date;
      accepted_at: Date | null;
    }>(
      `SELECT id, team_id, email, role, expires_at, accepted_at
       FROM team_invitations WHERE token = $1`,
      [token]
    );

    if (invRows.length === 0) {
      return reply.code(404).send({ error: 'Invitation not found' });
    }

    const invitation = invRows[0];

    if (invitation.accepted_at) {
      return reply.code(410).send({ error: 'Invitation already accepted' });
    }

    if (new Date() > invitation.expires_at) {
      return reply.code(410).send({ error: 'Invitation expired' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Mark invitation as accepted
      await client.query(
        `UPDATE team_invitations SET accepted_at = NOW() WHERE id = $1`,
        [invitation.id]
      );

      // Add member (ignore if already exists)
      await client.query(
        `INSERT INTO team_members (team_id, user_id, email, role, invited_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (team_id, user_id) DO NOTHING`,
        [invitation.team_id, user_id, email ?? invitation.email, invitation.role, invitation.email]
      );

      await client.query('COMMIT');

      return reply.send({
        team_id: invitation.team_id,
        role: invitation.role,
        message: 'Invitation accepted',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
}
