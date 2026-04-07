/**
 * Stripe billing helpers for Smara.
 *
 * Plan mapping:
 *   free       → 10,000 memories
 *   developer  → 200,000 memories   ($19/mo)
 *   pro        → 999,999,999 (unlimited) ($99/mo)
 */

import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('STRIPE_SECRET_KEY not set — Stripe billing disabled');
}

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-03-31.basil' as Stripe.LatestApiVersion })
  : null;

export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

/** Maps a Stripe price ID to the internal plan name. */
const PRICE_TO_PLAN: Record<string, { plan: string; memoryLimit: number }> = {};

/**
 * Populate PRICE_TO_PLAN from env vars so price IDs are not hard-coded.
 *
 * Expected env vars:
 *   STRIPE_PRICE_DEVELOPER=price_xxx
 *   STRIPE_PRICE_PRO=price_yyy
 */
function loadPriceMap(): void {
  const dev = process.env.STRIPE_PRICE_DEVELOPER;
  const pro = process.env.STRIPE_PRICE_PRO;

  if (dev) PRICE_TO_PLAN[dev] = { plan: 'developer', memoryLimit: 200_000 };
  if (pro) PRICE_TO_PLAN[pro] = { plan: 'pro', memoryLimit: 999_999_999 };
}

loadPriceMap();

export interface PlanInfo {
  plan: string;
  memoryLimit: number;
}

/**
 * Resolve a Stripe price ID to a Smara plan.
 * Returns null if the price ID is not mapped.
 */
export function planFromPriceId(priceId: string): PlanInfo | null {
  return PRICE_TO_PLAN[priceId] ?? null;
}

/**
 * Given a Stripe Subscription object, determine the highest plan.
 * If the subscription has multiple line items (unlikely), picks the highest tier.
 */
export function planFromSubscription(subscription: Stripe.Subscription): PlanInfo | null {
  let best: PlanInfo | null = null;

  for (const item of subscription.items.data) {
    const priceId = item.price.id;
    const info = planFromPriceId(priceId);
    if (!info) continue;

    if (!best || info.memoryLimit > best.memoryLimit) {
      best = info;
    }
  }

  return best;
}

/**
 * Default plan when a subscription is cancelled or payment fails.
 */
export const FREE_PLAN: PlanInfo = { plan: 'free', memoryLimit: 10_000 };
