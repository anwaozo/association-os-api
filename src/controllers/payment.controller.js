import { prisma, forTenant } from '../config/db.js';
import { env } from '../config/env.js';
import { logActivity, formatMoney } from '../utils/activity.js';
import {
   getStripe, stripeEnabled, toCents, feeFor, MIN_DONATION_CENTS, MAX_DONATION_CENTS,
} from '../utils/stripe.js';

const ORG_STATUS_ACTIVE = 1;
const settingsUrl = (q) => `${env.APP_URL}/settings?tab=payments&stripe=${q}`;

// ---------------------------------------------------------------------------
// Stripe Connect onboarding (org admins)
// ---------------------------------------------------------------------------

async function refreshAccountFlags(org) {
   const stripe = getStripe();
   if (!stripe || !org.stripeAccountId) return org;
   try {
      const acct = await stripe.accounts.retrieve(org.stripeAccountId);
      if (acct.charges_enabled !== org.stripeChargesEnabled || acct.details_submitted !== org.stripeDetailsSubmitted) {
         return prisma.organization.update({
            where: { id: org.id },
            data: { stripeChargesEnabled: Boolean(acct.charges_enabled), stripeDetailsSubmitted: Boolean(acct.details_submitted) },
         });
      }
   } catch (err) {
      console.error('Stripe account refresh failed:', err?.message);
   }
   return org;
}

const statusShape = (org) => ({
   stripeConfigured: stripeEnabled(),
   connected: Boolean(org.stripeAccountId),
   chargesEnabled: org.stripeChargesEnabled,
   detailsSubmitted: org.stripeDetailsSubmitted,
   platformFeePercent: org.platformFeePercent,
});

// GET /api/payments/status
export const getStatus = async (req, res) => {
   let org = await prisma.organization.findUnique({ where: { id: req.orgId } });
   org = await refreshAccountFlags(org);
   res.json(statusShape(org));
};

// POST /api/payments/connect  -> { url } of Stripe's hosted onboarding
export const connect = async (req, res) => {
   const stripe = getStripe();
   if (!stripe) return res.status(503).json({ message: 'Online payments are not set up on this platform yet.' });

   let org = await prisma.organization.findUnique({ where: { id: req.orgId } });
   if (!org.stripeAccountId) {
      const acct = await stripe.accounts.create({
         type: 'express',
         country: 'US',
         email: org.contactEmail || req.user.email,
         business_profile: { name: org.name },
         capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
         metadata: { organizationId: String(org.id) },
      });
      // Only set it if no one else did in the meantime (double click).
      const { count } = await prisma.organization.updateMany({
         where: { id: org.id, stripeAccountId: null },
         data: { stripeAccountId: acct.id },
      });
      org = await prisma.organization.findUnique({ where: { id: req.orgId } });
      if (!count) await stripe.accounts.del(acct.id).catch(() => {});
   }

   const link = await stripe.accountLinks.create({
      account: org.stripeAccountId,
      refresh_url: settingsUrl('refresh'),
      return_url: settingsUrl('return'),
      type: 'account_onboarding',
   });
   res.json({ url: link.url });
};

// POST /api/payments/dashboard  -> { url } of the org's Stripe Express dashboard
export const dashboardLink = async (req, res) => {
   const stripe = getStripe();
   if (!stripe) return res.status(503).json({ message: 'Online payments are not set up on this platform yet.' });
   const org = await prisma.organization.findUnique({ where: { id: req.orgId } });
   if (!org.stripeAccountId || !org.stripeDetailsSubmitted) {
      return res.status(400).json({ message: 'Finish connecting Stripe first.' });
   }
   const link = await stripe.accounts.createLoginLink(org.stripeAccountId);
   res.json({ url: link.url });
};

// PUT /api/platform/organizations/:id/fee { platformFeePercent }  (platform admin)
export const setPlatformFee = async (req, res) => {
   const id = Number(req.params.id);
   const pct = Number(req.body.platformFeePercent);
   if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
   if (!Number.isFinite(pct) || pct < 0 || pct > 30) return res.status(400).json({ message: 'Fee must be between 0 and 30 percent' });
   const org = await prisma.organization.update({ where: { id }, data: { platformFeePercent: pct }, select: { id: true, platformFeePercent: true } });
   res.json(org);
};

// ---------------------------------------------------------------------------
// Checkout (online donations)
// ---------------------------------------------------------------------------

function validateAmount(campaign, amountCents) {
   if (!amountCents) return 'Enter a donation amount';
   if (amountCents < MIN_DONATION_CENTS) return 'The minimum donation is $1';
   if (amountCents > MAX_DONATION_CENTS) return 'For gifts over $100,000 please contact the organization';
   if (campaign && campaign.isCustomAmount === false) {
      const presets = (Array.isArray(campaign.donation_amount) ? campaign.donation_amount : []).map(toCents).filter(Boolean);
      if (presets.length && !presets.includes(amountCents)) return 'Choose one of the suggested amounts';
   }
   return null;
}

// Creates the pending Donation and the Stripe Checkout Session.
async function startCheckout({ org, campaign, amountCents, donor, userId, isAnonymous, note, successUrl, cancelUrl }) {
   const stripe = getStripe();
   const db = forTenant(org.id);
   const fee = feeFor(amountCents, org.platformFeePercent);

   const donation = await db.donation.create({
      data: {
         campaignId: campaign?.id ?? null,
         userId: userId ?? null,
         donorName: donor.name || null,
         donorEmail: donor.email || null,
         amountCents,
         method: 'stripe',
         status: 'pending',
         isAnonymous: Boolean(isAnonymous),
         note: note ? String(note).slice(0, 500) : null,
         feeCents: fee,
      },
   });

   const metadata = { donationId: String(donation.id), organizationId: String(org.id) };
   const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      submit_type: 'donate',
      line_items: [{
         quantity: 1,
         price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: { name: campaign ? `Donation: ${campaign.name}` : `Donation to ${org.name}` },
         },
      }],
      ...(donor.email ? { customer_email: donor.email } : {}),
      payment_intent_data: {
         transfer_data: { destination: org.stripeAccountId },
         ...(fee > 0 ? { application_fee_amount: fee } : {}),
         description: campaign ? `${org.name}: ${campaign.name}` : `Donation to ${org.name}`,
         metadata,
      },
      metadata,
      success_url: successUrl,
      cancel_url: cancelUrl,
   }, { idempotencyKey: `donation-${donation.id}` });

   await db.donation.update({ where: { id: donation.id }, data: { stripeSessionId: session.id } });
   return session.url;
}

function checkoutReady(org) {
   if (!stripeEnabled()) return 'Online donations are not set up on this platform yet.';
   if (!org?.stripeAccountId || !org.stripeChargesEnabled) return 'This organization is not accepting online donations yet.';
   return null;
}

// GET /api/donations/availability  (any logged-in user) - can members give online?
export const availability = async (req, res) => {
   const org = await prisma.organization.findUnique({
      where: { id: req.orgId },
      select: { stripeAccountId: true, stripeChargesEnabled: true },
   });
   res.json({ acceptingDonations: !checkoutReady(org) });
};

// POST /api/donations/checkout { campaignId?, amount, isAnonymous, note }  (logged-in member or admin)
export const memberCheckout = async (req, res) => {
   const org = await prisma.organization.findUnique({ where: { id: req.orgId } });
   const notReady = checkoutReady(org);
   if (notReady) return res.status(400).json({ message: notReady });

   let campaign = null;
   if (req.body.campaignId) {
      campaign = await req.db.campaign.findFirst({ where: { id: Number(req.body.campaignId) } });
      if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
   }
   const amountCents = toCents(req.body.amount);
   const invalid = validateAmount(campaign, amountCents);
   if (invalid) return res.status(400).json({ message: invalid });

   const me = await req.db.user.findFirst({ where: { id: req.user.id }, select: { id: true, name: true, email: true } });
   const back = `${env.APP_URL}/fundraising/give${campaign ? `?campaign=${campaign.id}` : ''}`;
   const url = await startCheckout({
      org, campaign, amountCents, userId: me.id, donor: { name: me.name, email: me.email },
      isAnonymous: req.body.isAnonymous, note: req.body.note,
      successUrl: `${env.APP_URL}/fundraising/give?status=success`,
      cancelUrl: back,
   });
   res.json({ url });
};

// Public campaign page data. GET /api/public/:orgSlug/campaigns/:slug
async function findPublicCampaign(orgSlug, slug) {
   const org = await prisma.organization.findUnique({ where: { slug: String(orgSlug) } });
   if (!org || org.status !== ORG_STATUS_ACTIVE) return {};
   const campaign = await forTenant(org.id).campaign.findFirst({ where: { slug: String(slug), isPublic: true } });
   return { org, campaign };
}

export const publicCampaign = async (req, res) => {
   const { org, campaign } = await findPublicCampaign(req.params.orgSlug, req.params.slug);
   if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
   const agg = await forTenant(org.id).donation.aggregate({
      where: { campaignId: campaign.id, status: 'succeeded' },
      _sum: { amountCents: true },
      _count: { _all: true },
   });
   res.json({
      organization: { name: org.name, slug: org.slug, logoUrl: org.logoUrl, primaryColor: org.primaryColor, tagline: org.tagline },
      campaign: {
         id: campaign.id, name: campaign.name, slug: campaign.slug, description: campaign.description,
         goal: campaign.goal, date: campaign.date, donation_amount: campaign.donation_amount,
         isCustomAmount: campaign.isCustomAmount, isAnonymous: campaign.isAnonymous, thank_you: campaign.thank_you,
      },
      raisedCents: agg._sum.amountCents || 0,
      donationCount: agg._count._all,
      acceptingDonations: !checkoutReady(org),
   });
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/public/:orgSlug/campaigns/:slug/checkout { amount, donorName, donorEmail, isAnonymous, note }
export const publicCheckout = async (req, res) => {
   const { org, campaign } = await findPublicCampaign(req.params.orgSlug, req.params.slug);
   if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
   const notReady = checkoutReady(org);
   if (notReady) return res.status(400).json({ message: notReady });

   const donorName = String(req.body.donorName || '').trim().slice(0, 120);
   const donorEmail = String(req.body.donorEmail || '').trim().toLowerCase().slice(0, 200);
   if (!donorName) return res.status(400).json({ message: 'Your name is required' });
   if (!EMAIL_RE.test(donorEmail)) return res.status(400).json({ message: 'A valid email is required for your receipt' });

   const amountCents = toCents(req.body.amount);
   const invalid = validateAmount(campaign, amountCents);
   if (invalid) return res.status(400).json({ message: invalid });

   const page = `${env.APP_URL}/give/${org.slug}/${campaign.slug}`;
   const url = await startCheckout({
      org, campaign, amountCents, donor: { name: donorName, email: donorEmail },
      isAnonymous: req.body.isAnonymous, note: req.body.note,
      successUrl: `${page}?status=success`, cancelUrl: page,
   });
   res.json({ url });
};

// ---------------------------------------------------------------------------
// Stripe webhook  POST /api/payments/webhook  (raw body, no login)
// Platform events: checkout.session.*, charge.refunded
// Connect events:  account.updated
// ---------------------------------------------------------------------------

function constructEvent(stripe, raw, signature) {
   const secrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(Boolean);
   for (const secret of secrets) {
      try {
         return stripe.webhooks.constructEvent(raw, signature, secret);
      } catch {
         // try the next secret
      }
   }
   return null;
}

async function markSucceeded(session) {
   const donationId = Number(session.metadata?.donationId);
   const orgId = Number(session.metadata?.organizationId);
   if (!Number.isInteger(donationId) || !Number.isInteger(orgId)) return;
   const db = forTenant(orgId);

   const { count } = await db.donation.updateMany({
      where: { id: donationId, status: { not: 'succeeded' } },
      data: {
         status: 'succeeded',
         paidAt: new Date(),
         stripeSessionId: session.id,
         stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
      },
   });
   if (!count) return; // already processed (Stripe retries webhooks)

   const d = await db.donation.findFirst({ where: { id: donationId }, include: { campaign: { select: { name: true } } } });
   if (!d.donorName && session.customer_details?.name) {
      await db.donation.update({ where: { id: d.id }, data: { donorName: session.customer_details.name } });
      d.donorName = session.customer_details.name;
   }
   await logActivity(db, {
      type: 'donation',
      actorId: d.userId,
      title: `${d.isAnonymous ? 'An anonymous donor' : d.donorName || 'A donor'} gave ${formatMoney(d.amountCents)}${d.campaign ? ` to ${d.campaign.name}` : ''}`,
      detail: 'Online (Stripe)',
      meta: { donationId: d.id, campaignId: d.campaignId },
   });
}

async function markFailed(session) {
   const donationId = Number(session.metadata?.donationId);
   const orgId = Number(session.metadata?.organizationId);
   if (!Number.isInteger(donationId) || !Number.isInteger(orgId)) return;
   await forTenant(orgId).donation.updateMany({ where: { id: donationId, status: 'pending' }, data: { status: 'failed' } });
}

export const stripeWebhook = async (req, res) => {
   const stripe = getStripe();
   if (!stripe) return res.status(503).json({ message: 'Stripe is not configured' });
   const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));
   const event = constructEvent(stripe, raw, req.headers['stripe-signature']);
   if (!event) return res.status(400).json({ message: 'Invalid signature' });

   const obj = event.data.object;
   switch (event.type) {
      case 'checkout.session.completed':
         if (obj.payment_status === 'paid') await markSucceeded(obj);
         break;
      case 'checkout.session.async_payment_succeeded':
         await markSucceeded(obj);
         break;
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
         await markFailed(obj);
         break;
      case 'charge.refunded': {
         const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id;
         if (pi && obj.refunded) {
            await prisma.donation.updateMany({ where: { stripePaymentIntentId: pi }, data: { status: 'refunded' } });
         }
         break;
      }
      case 'account.updated':
         await prisma.organization.updateMany({
            where: { stripeAccountId: obj.id },
            data: { stripeChargesEnabled: Boolean(obj.charges_enabled), stripeDetailsSubmitted: Boolean(obj.details_submitted) },
         });
         break;
      default:
         break;
   }
   res.json({ received: true });
};


// ---------------------------------------------------------------------------
// Refund an online gift from AssociationOS  POST /api/donations/:id/refund (admin)
// Full refund. The transfer to the org's account is reversed (and any
// platform fee returned), so the money comes back out of the org's balance,
// same as ticking "Reverse the associated transfer" in the Stripe dashboard.
// ---------------------------------------------------------------------------
export const refundDonation = async (req, res) => {
   const stripe = getStripe();
   if (!stripe) return res.status(503).json({ message: 'Online payments are not set up on this platform yet.' });
   const id = Number(req.params.id);
   if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });

   const d = await req.db.donation.findFirst({ where: { id }, include: { campaign: { select: { name: true } } } });
   if (!d) return res.status(404).json({ message: 'Donation not found' });
   if (d.method !== 'stripe') return res.status(400).json({ message: 'Only online gifts can be refunded here. Delete a recorded gift instead.' });
   if (d.status === 'refunded') return res.status(400).json({ message: 'This gift was already refunded' });
   if (d.status !== 'succeeded' || !d.stripePaymentIntentId) return res.status(400).json({ message: 'Only paid gifts can be refunded' });

   try {
      await stripe.refunds.create(
         {
            payment_intent: d.stripePaymentIntentId,
            reverse_transfer: true,
            ...(d.feeCents > 0 ? { refund_application_fee: true } : {}),
            reason: 'requested_by_customer',
            metadata: { donationId: String(d.id), organizationId: String(req.orgId), refundedBy: String(req.user.id) },
         },
         { idempotencyKey: `refund-donation-${d.id}` },
      );
   } catch (err) {
      const msg = err?.raw?.message || err?.message || 'Stripe could not refund this gift';
      // Already refunded in the dashboard: just record it.
      if (err?.code !== 'charge_already_refunded') return res.status(400).json({ message: msg });
   }

   const updated = await req.db.donation.update({
      where: { id: d.id },
      data: { status: 'refunded' },
      include: { campaign: { select: { id: true, name: true, slug: true } } },
   });
   await logActivity(req.db, {
      type: 'donation',
      actorId: req.user.id,
      title: `Refunded ${formatMoney(d.amountCents)} to ${d.isAnonymous ? 'an anonymous donor' : d.donorName || 'a donor'}${d.campaign ? ` (${d.campaign.name})` : ''}`,
      detail: 'Refund issued from AssociationOS',
      meta: { donationId: d.id, campaignId: d.campaignId, refund: true },
   });
   res.json(updated);
};
