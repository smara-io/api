/**
 * POST /webhooks/stripe — Stripe webhook handler.
 *
 * Handles:
 *   - checkout.session.completed  → link Stripe customer to tenant, upgrade plan
 *   - invoice.payment_succeeded   → renew / upgrade plan on recurring payment
 *   - customer.subscription.deleted → downgrade to free on cancellation
 *
 * The raw body is required for signature verification, so this route
 * must receive the unparsed body. Fastify's addContentTypeParser is
 * configured to pass it through as a Buffer.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Stripe from 'stripe';
import { stripe, WEBHOOK_SECRET, planFromPriceId, planFromSubscription, FREE_PLAN } from '../billing/stripe.js';
import { pool } from '../db/pool.js';

async function upsertTenantPlan(
  tenantId: string,
  plan: string,
  memoryLimit: number,
  stripeCustomerId?: string
): Promise<void> {
  const setClauses = [
    `plan = $2`,
    `memory_limit = $3`,
  ];
  const params: (string | number)[] = [tenantId, plan, memoryLimit];

  if (stripeCustomerId) {
    setClauses.push(`stripe_customer_id = $${params.length + 1}`);
    params.push(stripeCustomerId);
  }

  await pool.query(
    `UPDATE tenants SET ${setClauses.join(', ')} WHERE id = $1`,
    params
  );
}

/**
 * Find tenant by stripe_customer_id.
 */
async function tenantByStripeCustomer(customerId: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE stripe_customer_id = $1 LIMIT 1`,
    [customerId]
  );
  return rows[0]?.id ?? null;
}

/**
 * Find tenant by metadata.tenant_id stored in the Checkout Session.
 * This is the primary linkage for first-time checkout.
 */
async function tenantExists(tenantId: string): Promise<boolean> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return rows.length > 0;
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (!stripe) return;

  // We require tenant_id in checkout session metadata (set when creating checkout link)
  const tenantId = session.metadata?.tenant_id;
  const customerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id;

  if (!tenantId && !customerId) {
    console.warn('[stripe-webhook] checkout.session.completed: no tenant_id in metadata and no customer');
    return;
  }

  // Resolve tenant — prefer metadata, fall back to customer lookup
  let resolvedTenantId: string | undefined = tenantId;
  if (!resolvedTenantId && customerId) {
    resolvedTenantId = (await tenantByStripeCustomer(customerId)) ?? undefined;
  }
  if (!resolvedTenantId) {
    console.warn('[stripe-webhook] checkout.session.completed: could not resolve tenant');
    return;
  }

  // Verify tenant exists
  if (!(await tenantExists(resolvedTenantId))) {
    console.warn(`[stripe-webhook] tenant ${resolvedTenantId} not found in DB`);
    return;
  }

  // Get subscription details to determine plan
  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;

  if (!subscriptionId) {
    console.warn('[stripe-webhook] checkout.session.completed: no subscription');
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const planInfo = planFromSubscription(subscription);

  if (!planInfo) {
    console.warn(`[stripe-webhook] no plan mapping for subscription ${subscriptionId}`);
    return;
  }

  await upsertTenantPlan(
    resolvedTenantId,
    planInfo.plan,
    planInfo.memoryLimit,
    customerId ?? undefined,
  );

  console.log(`[stripe-webhook] checkout complete: tenant=${resolvedTenantId} plan=${planInfo.plan}`);
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  if (!stripe) return;

  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;

  if (!customerId) {
    console.warn('[stripe-webhook] invoice.payment_succeeded: no customer');
    return;
  }

  const tenantId = await tenantByStripeCustomer(customerId);
  if (!tenantId) {
    // For first-time payments, checkout.session.completed handles the link.
    // If we get invoice.payment_succeeded without a tenant, log and skip.
    console.warn(`[stripe-webhook] invoice.payment_succeeded: no tenant for customer ${customerId}`);
    return;
  }

  // Get the subscription from the invoice's parent details (Stripe 2025+ SDK)
  const subDetails = invoice.parent?.subscription_details;
  const subscriptionId = subDetails
    ? (typeof subDetails.subscription === 'string'
        ? subDetails.subscription
        : subDetails.subscription?.id)
    : undefined;

  if (!subscriptionId) {
    // One-time payment or no subscription — skip
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const planInfo = planFromSubscription(subscription);

  if (!planInfo) {
    console.warn(`[stripe-webhook] no plan mapping for subscription ${subscriptionId}`);
    return;
  }

  await upsertTenantPlan(tenantId, planInfo.plan, planInfo.memoryLimit);
  console.log(`[stripe-webhook] invoice paid: tenant=${tenantId} plan=${planInfo.plan}`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;

  if (!customerId) return;

  const tenantId = await tenantByStripeCustomer(customerId);
  if (!tenantId) return;

  await upsertTenantPlan(tenantId, FREE_PLAN.plan, FREE_PLAN.memoryLimit);
  console.log(`[stripe-webhook] subscription cancelled: tenant=${tenantId} downgraded to free`);
}

// ── Route ───────────────────────────────────────────────────────────────────

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // Register a raw body content-type parser for this route.
  // Stripe requires the raw body for signature verification.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    }
  );

  app.post('/webhooks/stripe', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!stripe) {
      return reply.code(503).send({ error: 'Stripe not configured' });
    }

    if (!WEBHOOK_SECRET) {
      return reply.code(503).send({ error: 'Stripe webhook secret not configured' });
    }

    // Verify signature
    const signature = request.headers['stripe-signature'] as string | undefined;
    if (!signature) {
      return reply.code(400).send({ error: 'Missing stripe-signature header' });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        request.body as Buffer,
        signature,
        WEBHOOK_SECRET
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[stripe-webhook] signature verification failed: ${msg}`);
      return reply.code(400).send({ error: `Webhook signature verification failed` });
    }

    // Dispatch by event type
    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;

        case 'invoice.payment_succeeded':
          await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
          break;

        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;

        default:
          // Ignore events we don't handle
          break;
      }
    } catch (err) {
      console.error(`[stripe-webhook] error handling ${event.type}:`, err);
      // Return 200 anyway to prevent Stripe retries for bugs on our side.
      // Stripe will retry on 5xx, but our handler errors should be investigated separately.
      return reply.code(200).send({ received: true, error: 'Internal handler error' });
    }

    return reply.code(200).send({ received: true });
  });
}
