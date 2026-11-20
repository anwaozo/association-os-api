import Stripe from 'stripe';
import { env } from '../config/env.js';

// Stripe Connect (Express accounts, destination charges). Everything that
// needs Stripe checks stripeEnabled() first; without STRIPE_SECRET_KEY the
// rest of Fundraising (campaigns, offline gifts) keeps working.
let client = null;
export const stripeEnabled = () => Boolean(env.STRIPE_SECRET_KEY);
export function getStripe() {
   if (!stripeEnabled()) return null;
   if (!client) client = new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 15000 });
   return client;
}

// Tests can swap in a fake client.
export function setStripeForTests(fake) {
   client = fake;
}

export const MIN_DONATION_CENTS = 100; // $1
export const MAX_DONATION_CENTS = 10_000_000; // $100,000

// "25", 25, "$25.50" -> 2550. Returns null when not a usable amount.
export function toCents(v) {
   const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
   if (!Number.isFinite(n) || n <= 0) return null;
   return Math.round(n * 100);
}

export const feeFor = (amountCents, percent) =>
   percent > 0 ? Math.round((amountCents * Math.min(percent, 30)) / 100) : 0;
