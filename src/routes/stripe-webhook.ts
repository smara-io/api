import { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';
import crypto from 'crypto';

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

const PLAN_MAP: Record<string, { plan: string; memoryLimit: number }> = {
  // Live Stripe price IDs → plan config (updated 2026-03-30)
  'price_1TGkCV40cOBHeEx0NCRVwVIJ': { plan: 'developer', memoryLimit: 200_000 },     // $19/mo
  'price_1TGkCV40cOBHeEx0r7pjaTMS': { plan: 'pro',       memoryLimit: 2_000_000 },   // $99/mo
};

function verifyStripeSignature(payload: string, signature: string, secret: string): boolean {
  if (!secret) return false;
  const parts = signature.split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {} as Record<string, string>);

  const timestamp = parts['t'];
  const v1 = parts['v1'];
  if (!timestamp || !v1) return false;

  // Reject if timestamp is more than 5 minutes old
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}

export async function stripeWebhookRoutes(app: FastifyInstance) {
  // Stripe sends raw body, need to handle that
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/webhooks/stripe', async (request, reply) => {
    const signature = request.headers['stripe-signature'] as string;
    const rawBody = request.body as string;

    // Verify signature if secret is configured
    if (STRIPE_WEBHOOK_SECRET) {
      if (!signature || !verifyStripeSignature(rawBody, signature, STRIPE_WEBHOOK_SECRET)) {
        return reply.status(400).send({ error: 'Invalid signature' });
      }
    }

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return reply.status(400).send({ error: 'Invalid JSON' });
    }

    const type = event.type;
    request.log.info({ type, id: event.id }, 'Stripe webhook received');

    switch (type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        const metadata = session.metadata ?? {};
        const tenantId = metadata.tenant_id;

        if (tenantId && customerId) {
          // Store Stripe customer ID on tenant
          await pool.query(
            `UPDATE tenants SET stripe_customer_id = $1 WHERE id = $2`,
            [customerId, tenantId],
          );
          request.log.info({ tenantId, customerId }, 'Linked Stripe customer to tenant');
        }

        if (subscriptionId) {
          await upgradeTenantFromSubscription(subscriptionId, tenantId, request.log);
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const subscriptionId = invoice.subscription;

        if (subscriptionId && customerId) {
          // Find tenant by Stripe customer ID
          const { rows } = await pool.query(
            `SELECT id FROM tenants WHERE stripe_customer_id = $1`,
            [customerId],
          );
          const tenantId = rows[0]?.id;
          if (tenantId) {
            await upgradeTenantFromSubscription(subscriptionId, tenantId, request.log);
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        // Downgrade to free
        const { rows } = await pool.query(
          `SELECT id FROM tenants WHERE stripe_customer_id = $1`,
          [customerId],
        );
        const tenantId = rows[0]?.id;
        if (tenantId) {
          await pool.query(
            `UPDATE tenants SET plan = 'free', memory_limit = 10000 WHERE id = $1`,
            [tenantId],
          );
          request.log.info({ tenantId }, 'Downgraded tenant to free');
        }
        break;
      }

      default:
        request.log.info({ type }, 'Unhandled Stripe event');
    }

    return { received: true };
  });
}

async function upgradeTenantFromSubscription(
  subscriptionId: string,
  tenantId: string | undefined,
  log: any,
) {
  if (!tenantId) return;

  // Fetch subscription details from Stripe to get the price ID
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    log.warn('STRIPE_SECRET_KEY not set, cannot fetch subscription details');
    return;
  }

  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    if (!res.ok) {
      log.error({ status: res.status }, 'Failed to fetch Stripe subscription');
      return;
    }
    const sub = await res.json() as any;
    const priceId = sub.items?.data?.[0]?.price?.id;

    const planConfig = PLAN_MAP[priceId];
    if (planConfig) {
      await pool.query(
        `UPDATE tenants SET plan = $1, memory_limit = $2 WHERE id = $3`,
        [planConfig.plan, planConfig.memoryLimit, tenantId],
      );
      log.info({ tenantId, plan: planConfig.plan, memoryLimit: planConfig.memoryLimit }, 'Upgraded tenant');
    } else {
      log.warn({ priceId }, 'Unknown Stripe price ID, no plan mapping');
    }
  } catch (err) {
    log.error({ err }, 'Error upgrading tenant from subscription');
  }
}
