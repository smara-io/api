/**
 * Email drip queue routes — queue, list, and process scheduled emails.
 *
 * Uses PostgreSQL as the queue backend (no external deps).
 * Sends via Resend API if RESEND_API_KEY is set, otherwise logs.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { DRIP_TEMPLATES, DRIP_SCHEDULE } from '../email-templates.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'Smara <noreply@smara.io>';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? '';

/* ── DB migration ─────────────────────────────────────────────── */

export async function migrateEmailQueue(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_queue (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email         TEXT NOT NULL,
      template_key  TEXT NOT NULL,
      scheduled_at  TIMESTAMPTZ NOT NULL,
      sent_at       TIMESTAMPTZ,
      status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
      error         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS email_queue_pending_idx ON email_queue(scheduled_at) WHERE status = 'pending'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS email_queue_tenant_idx ON email_queue(tenant_id)`);
  console.log('[Email] email_queue table ready');
}

/* ── Queue helper: enqueue drip sequence for a new signup ─────── */

export async function enqueueDripSequence(
  tenantId: string,
  email: string,
  apiKey?: string,
): Promise<void> {
  const name = email.split('@')[0];

  // Store apiKey in a transient way — only the welcome email needs it
  // We encode it in the template_key as welcome::<apiKey> for day-0 only
  const values: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  for (const step of DRIP_SCHEDULE) {
    const templateKey = step.templateKey === 'welcome' && apiKey
      ? `welcome::${apiKey}`
      : step.templateKey;

    values.push(
      `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, NOW() + INTERVAL '${step.delayDays} days', 'pending')`,
    );
    params.push(tenantId, email, templateKey);
    paramIdx += 3;
  }

  await pool.query(
    `INSERT INTO email_queue (tenant_id, email, template_key, scheduled_at, status) VALUES ${values.join(', ')}`,
    params,
  );

  console.log(`[Email] Queued ${DRIP_SCHEDULE.length} drip emails for ${email}`);
}

/* ── Send a single email via Resend (or log) ──────────────────── */

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log(`[Email][DRY] To: ${to} | Subject: ${subject}`);
    return true; // treat as sent in dev mode
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.warn(`[Email] Resend error ${res.status}: ${body}`);
    return false;
  }
  return true;
}

/* ── Admin auth check ─────────────────────────────────────────── */

function isAdmin(request: FastifyRequest): boolean {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return false;
  const key = authHeader.slice(7);
  return ADMIN_API_KEY.length > 0 && key === ADMIN_API_KEY;
}

/* ── Routes ───────────────────────────────────────────────────── */

export async function emailRoutes(app: FastifyInstance): Promise<void> {

  await migrateEmailQueue();

  /* ─── POST /v1/email/send — send a single email ────────────── */
  app.post<{
    Body: { to: string; subject: string; html: string };
  }>('/v1/email/send', {
    schema: {
      body: {
        type: 'object',
        required: ['to', 'subject', 'html'],
        properties: {
          to:      { type: 'string', format: 'email' },
          subject: { type: 'string', minLength: 1, maxLength: 200 },
          html:    { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    if (!isAdmin(request)) {
      return reply.code(401).send({ error: 'Admin access required' });
    }

    const { to, subject, html } = request.body;
    const ok = await sendEmail(to, subject, html);

    return reply.send({
      sent: ok,
      mode: RESEND_API_KEY ? 'resend' : 'dry-run',
    });
  });

  /* ─── GET /v1/email/queue — list pending emails ────────────── */
  app.get<{
    Querystring: { status?: string; limit?: string };
  }>('/v1/email/queue', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'sent', 'failed', 'skipped'] },
          limit:  { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    if (!isAdmin(request)) {
      return reply.code(401).send({ error: 'Admin access required' });
    }

    const status = request.query.status ?? 'pending';
    const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 200);

    const { rows } = await pool.query(
      `SELECT id, tenant_id, email, template_key, scheduled_at, sent_at, status, error, created_at
       FROM email_queue
       WHERE status = $1
       ORDER BY scheduled_at ASC
       LIMIT $2`,
      [status, limit],
    );

    return reply.send({ emails: rows, count: rows.length });
  });

  /* ─── POST /v1/email/process — process due emails (cron) ───── */
  app.post('/v1/email/process', async (request, reply) => {
    if (!isAdmin(request)) {
      return reply.code(401).send({ error: 'Admin access required' });
    }

    // Fetch up to 50 emails that are due
    const { rows } = await pool.query<{
      id: string;
      tenant_id: string;
      email: string;
      template_key: string;
    }>(
      `SELECT id, tenant_id, email, template_key
       FROM email_queue
       WHERE status = 'pending' AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC
       LIMIT 50`,
    );

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      // Parse template key (may contain apiKey for welcome emails)
      let templateKey = row.template_key;
      let apiKey: string | undefined;

      if (templateKey.startsWith('welcome::')) {
        apiKey = templateKey.slice('welcome::'.length);
        templateKey = 'welcome';
      }

      const templateFn = DRIP_TEMPLATES[templateKey];
      if (!templateFn) {
        await pool.query(
          `UPDATE email_queue SET status = 'skipped', error = 'Unknown template' WHERE id = $1`,
          [row.id],
        );
        skipped++;
        continue;
      }

      const name = row.email.split('@')[0];
      const { subject, html } = templateFn({ name, email: row.email, apiKey });

      try {
        const ok = await sendEmail(row.email, subject, html);
        if (ok) {
          await pool.query(
            `UPDATE email_queue SET status = 'sent', sent_at = NOW() WHERE id = $1`,
            [row.id],
          );
          sent++;
        } else {
          await pool.query(
            `UPDATE email_queue SET status = 'failed', error = 'Resend API returned error' WHERE id = $1`,
            [row.id],
          );
          failed++;
        }
      } catch (err: any) {
        await pool.query(
          `UPDATE email_queue SET status = 'failed', error = $2 WHERE id = $1`,
          [row.id, err.message?.slice(0, 500) ?? 'Unknown error'],
        );
        failed++;
      }
    }

    console.log(`[Email] Processed ${rows.length} emails: ${sent} sent, ${failed} failed, ${skipped} skipped`);

    return reply.send({ processed: rows.length, sent, failed, skipped });
  });
}
