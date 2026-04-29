/**
 * Billing routes — Stripe Checkout, Portal, Usage, Webhook
 *
 * Env vars:
 *   STRIPE_SECRET_KEY       — sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET   — whsec_...
 *   STRIPE_PRICE_DEV        — price ID for Developer $19/mo
 *   STRIPE_PRICE_TEAM       — price ID for Team $79/mo
 *   STRIPE_PRICE_BIZ        — price ID for Business $199/mo
 */

import Stripe from 'stripe';
import crypto from 'crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { sendApiKeyEmail } from '../email.js';

/* ── Plan config ───────────────────────────────────────────────── */

interface PlanConfig {
  plan: string;
  memoryLimit: number;
  agentLimit: number;
  teamLimit: number;
  membersPerTeamLimit: number;
}

const PLAN_CONFIGS: Record<string, PlanConfig> = {
  free:      { plan: 'free',      memoryLimit: 100,        agentLimit: 1,  teamLimit: 0,  membersPerTeamLimit: 0 },
  developer: { plan: 'developer', memoryLimit: 10_000,     agentLimit: 5,  teamLimit: 1,  membersPerTeamLimit: 5 },
  team:      { plan: 'team',      memoryLimit: 100_000,    agentLimit: 25, teamLimit: 5,  membersPerTeamLimit: 25 },
  business:  { plan: 'business',  memoryLimit: 999_999_999, agentLimit: 999_999, teamLimit: 999_999, membersPerTeamLimit: 999_999 },
};

function getPriceMap(): Record<string, PlanConfig> {
  const map: Record<string, PlanConfig> = {};
  if (process.env.STRIPE_PRICE_DEV)  map[process.env.STRIPE_PRICE_DEV]  = PLAN_CONFIGS.developer;
  if (process.env.STRIPE_PRICE_TEAM) map[process.env.STRIPE_PRICE_TEAM] = PLAN_CONFIGS.team;
  if (process.env.STRIPE_PRICE_BIZ)  map[process.env.STRIPE_PRICE_BIZ]  = PLAN_CONFIGS.business;
  return map;
}

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(key, { apiVersion: '2024-12-18.acacia' as any });
}

function generateApiKey(): string {
  return `smara_${crypto.randomBytes(32).toString('hex')}`;
}

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/* ── Routes ────────────────────────────────────────────────────── */

export async function billingRoutes(app: FastifyInstance): Promise<void> {

  /* ─── POST /v1/billing/checkout ──────────────────────────────── */
  app.post<{
    Body: { plan: 'developer' | 'team' | 'business'; email: string; success_url?: string; cancel_url?: string };
  }>('/v1/billing/checkout', {
    schema: {
      body: {
        type: 'object',
        required: ['plan', 'email'],
        properties: {
          plan:        { type: 'string', enum: ['developer', 'team', 'business'] },
          email:       { type: 'string', format: 'email' },
          success_url: { type: 'string' },
          cancel_url:  { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { plan, email, success_url, cancel_url } = request.body;

    const priceEnvMap: Record<string, string | undefined> = {
      developer: process.env.STRIPE_PRICE_DEV,
      team:      process.env.STRIPE_PRICE_TEAM,
      business:  process.env.STRIPE_PRICE_BIZ,
    };

    const priceId = priceEnvMap[plan];
    if (!priceId) {
      return reply.code(500).send({ error: `Stripe price not configured for plan: ${plan}` });
    }

    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: success_url ?? `${process.env.BASE_URL ?? 'https://smara.io'}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  cancel_url  ?? `${process.env.BASE_URL ?? 'https://smara.io'}/#pricing`,
      metadata: { plan, email },
    });

    return reply.send({ checkout_url: session.url });
  });

  /* ─── POST /v1/billing/webhook ───────────────────────────────── */
  app.post('/v1/billing/webhook', {
    config: { rawBody: true },
  }, async (request, reply) => {
    const stripe = getStripe();
    const sig = request.headers['stripe-signature'] as string;
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!secret) {
      request.log.warn('STRIPE_WEBHOOK_SECRET not set — skipping webhook verification');
      return reply.code(500).send({ error: 'Webhook secret not configured' });
    }

    let event: Stripe.Event;
    try {
      // Body comes as string from the custom content-type parser registered in stripe-webhook.ts
      const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (err: any) {
      request.log.error({ err: err.message }, 'Webhook signature verification failed');
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    request.log.info({ type: event.type, id: event.id }, 'Billing webhook received');

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const email = session.metadata?.email ?? session.customer_email ?? '';
        const planName = session.metadata?.plan ?? 'developer';
        const customerId = session.customer as string;

        if (!email) {
          request.log.error('No email in checkout session');
          break;
        }

        const planConfig = PLAN_CONFIGS[planName] ?? PLAN_CONFIGS.developer;

        // Check if tenant already exists for this email
        const { rows: existing } = await pool.query(
          'SELECT id FROM tenants WHERE email = $1 LIMIT 1',
          [email.toLowerCase()],
        );

        let tenantId: string;

        if (existing.length > 0) {
          // Upgrade existing tenant
          tenantId = existing[0].id;
          await pool.query(
            `UPDATE tenants
             SET plan = $1, memory_limit = $2, agent_limit = $3, team_limit = $4,
                 members_per_team_limit = $5, stripe_customer_id = $6
             WHERE id = $7`,
            [planConfig.plan, planConfig.memoryLimit, planConfig.agentLimit,
             planConfig.teamLimit, planConfig.membersPerTeamLimit, customerId, tenantId],
          );
          request.log.info({ tenantId, plan: planConfig.plan }, 'Upgraded existing tenant');
        } else {
          // Create new tenant + API key
          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            const { rows: tenantRows } = await client.query<{ id: string }>(
              `INSERT INTO tenants (name, email, plan, memory_limit, agent_limit, team_limit, members_per_team_limit, stripe_customer_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
              [email.split('@')[0], email.toLowerCase(), planConfig.plan, planConfig.memoryLimit,
               planConfig.agentLimit, planConfig.teamLimit, planConfig.membersPerTeamLimit, customerId],
            );
            tenantId = tenantRows[0].id;

            const rawKey = generateApiKey();
            const keyHash = hashKey(rawKey);
            await client.query(
              `INSERT INTO api_keys (tenant_id, key_hash, label) VALUES ($1, $2, 'Checkout key')`,
              [tenantId, keyHash],
            );

            await client.query('COMMIT');

            // Send welcome email with API key (best-effort)
            console.log(`[Billing] Welcome email for ${email} — API key provisioned (plan: ${planConfig.plan})`);
            sendApiKeyEmail(email, rawKey).catch(() => {});
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          } finally {
            client.release();
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const priceId = subscription.items.data[0]?.price?.id;
        const priceMap = getPriceMap();
        const planConfig = priceId ? priceMap[priceId] : undefined;

        if (planConfig) {
          await pool.query(
            `UPDATE tenants
             SET plan = $1, memory_limit = $2, agent_limit = $3, team_limit = $4, members_per_team_limit = $5
             WHERE stripe_customer_id = $6`,
            [planConfig.plan, planConfig.memoryLimit, planConfig.agentLimit,
             planConfig.teamLimit, planConfig.membersPerTeamLimit, customerId],
          );
          request.log.info({ customerId, plan: planConfig.plan }, 'Subscription updated');
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const free = PLAN_CONFIGS.free;

        await pool.query(
          `UPDATE tenants
           SET plan = $1, memory_limit = $2, agent_limit = $3, team_limit = $4, members_per_team_limit = $5
           WHERE stripe_customer_id = $6`,
          [free.plan, free.memoryLimit, free.agentLimit,
           free.teamLimit, free.membersPerTeamLimit, customerId],
        );
        request.log.info({ customerId }, 'Subscription cancelled — downgraded to free');
        break;
      }

      default:
        request.log.info({ type: event.type }, 'Unhandled billing event');
    }

    return { received: true };
  });

  /* ─── GET /v1/billing/portal ─────────────────────────────────── */
  app.get('/v1/billing/portal', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { rows } = await pool.query<{ stripe_customer_id: string | null }>(
      'SELECT stripe_customer_id FROM tenants WHERE id = $1',
      [request.tenantId],
    );

    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) {
      return reply.code(404).send({ error: 'No billing account found. Subscribe to a plan first.' });
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.BASE_URL ?? 'https://smara.io'}`,
    });

    return reply.send({ portal_url: session.url });
  });

  /* ─── GET /v1/billing/usage ──────────────────────────────────── */
  app.get('/v1/billing/usage', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { rows: [tenant] } = await pool.query<{
      plan: string; memory_limit: number; agent_limit: number; team_limit: number;
    }>(
      'SELECT plan, memory_limit, agent_limit, team_limit FROM tenants WHERE id = $1',
      [request.tenantId],
    );

    const { rows: [memCount] } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM memories WHERE tenant_id = $1 AND valid_until IS NULL`,
      [request.tenantId],
    );

    const { rows: [agentCount] } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM agents WHERE tenant_id = $1`,
      [request.tenantId],
    );

    const { rows: [teamCount] } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM teams WHERE tenant_id = $1`,
      [request.tenantId],
    );

    return reply.send({
      plan: tenant.plan,
      usage: {
        memories: { used: parseInt(memCount.count, 10), limit: tenant.memory_limit },
        agents:   { used: parseInt(agentCount.count, 10), limit: tenant.agent_limit },
        teams:    { used: parseInt(teamCount.count, 10), limit: tenant.team_limit },
      },
    });
  });
}
