// Directory profiles, Notifications, Messages and Fundraising (donations,
// Stripe Connect). Stripe and Resend are replaced with fakes; nothing leaves
// the machine. Needs the same migrated + seeded database as isolation.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';

process.env.NODE_ENV = 'test';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_platform';
process.env.APP_URL = 'https://app.example.test';
// Email starts switched OFF (RESEND_API_KEY unset); one test turns it on.

const { default: app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { env } = await import('../src/config/env.js');
const { setStripeForTests } = await import('../src/utils/stripe.js');

const PASSWORD = process.env.SEED_PASSWORD || 'Demo@2026!';
const A = { admin: 'admin@bayoucitychamber.org', member: 'monique@bayoucitychamber.org', slug: 'bayou-city-chamber' };
const B = { admin: 'admin@lonestarpros.org', member: 'evelyn@lonestarpros.org', slug: 'lone-star-pros' };
const PLATFORM = (process.env.SEED_PLATFORM_EMAIL || 'admin@associationos.app').toLowerCase();

let server, base;
const t = {};

// ---- fakes ------------------------------------------------------------------
const stripeCalls = [];
const realWebhooks = new Stripe('sk_test_fake').webhooks;
const fakeStripe = {
   accounts: {
      create: async (p) => { stripeCalls.push(['accounts.create', p]); return { id: `acct_${Date.now()}` }; },
      retrieve: async (id) => ({ id, charges_enabled: true, details_submitted: true }),
      del: async () => ({}),
      createLoginLink: async () => ({ url: 'https://connect.stripe.test/express/login' }),
   },
   accountLinks: { create: async (p) => { stripeCalls.push(['accountLinks.create', p]); return { url: 'https://connect.stripe.test/setup/abc' }; } },
   checkout: {
      sessions: {
         create: async (p, opts) => {
            stripeCalls.push(['checkout.sessions.create', p, opts]);
            return { id: `cs_test_${stripeCalls.length}_${Date.now()}`, url: 'https://checkout.stripe.test/pay' };
         },
      },
   },
   webhooks: realWebhooks,
};

const resendBatches = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
   if (String(url).startsWith('https://api.resend.com/')) {
      const emails = JSON.parse(opts.body);
      resendBatches.push(emails);
      // Fail anyone whose address contains "bounce"
      if (emails.every((e) => e.to[0].includes('bounce'))) {
         return new Response(JSON.stringify({ message: 'Invalid to address' }), { status: 422 });
      }
      return new Response(JSON.stringify({ data: emails.map((_, i) => ({ id: `re_${resendBatches.length}_${i}` })) }), { status: 200 });
   }
   return realFetch(url, opts);
};

async function call(method, path, { token, body, headers, raw } = {}) {
   const res = await realFetch(base + path, {
      method,
      headers: {
         ...(raw ? {} : { 'Content-Type': 'application/json' }),
         ...(token ? { Authorization: `Bearer ${token}` } : {}),
         ...(headers || {}),
      },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
   });
   const text = await res.text();
   let json;
   try { json = JSON.parse(text); } catch { json = text; }
   return { status: res.status, body: json, raw: text };
}

async function login(email) {
   const r = await call('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
   assert.equal(r.status, 200, `login ${email}: ${r.raw}`);
   return r.body.accessToken;
}

const orgId = async (slug) => (await prisma.organization.findUnique({ where: { slug } })).id;

before(async () => {
   setStripeForTests(fakeStripe);
   server = app.listen(0);
   await new Promise((r) => server.once('listening', r));
   base = `http://127.0.0.1:${server.address().port}`;
   for (const [k, email] of Object.entries({ aAdmin: A.admin, aMember: A.member, bAdmin: B.admin, bMember: B.member, platform: PLATFORM })) {
      t[k] = await login(email);
   }
});

after(async () => {
   server.close();
   globalThis.fetch = realFetch;
   await prisma.$disconnect();
});

// ---- Directory -----------------------------------------------------------------

test('member edits their directory profile; others in the org see it', async () => {
   const r = await call('PUT', '/api/users/me', {
      token: t.aMember,
      body: { title: 'Owner', company: 'Bayou Bakes', location: 'Houston, TX', about: 'Bakery on Main St.', website: 'bayoubakes.com', tags: ['Food', 'Retail', 'Food', ' '] },
   });
   assert.equal(r.status, 200, r.raw);
   assert.equal(r.body.website, 'https://bayoubakes.com/');
   assert.deepEqual(r.body.tags, ['Food', 'Retail']);
   assert.equal(r.body.password, undefined);

   const dir = await call('GET', '/api/contacts', { token: t.aAdmin });
   const me = dir.body.find((u) => u.email === A.member);
   assert.equal(me.company, 'Bayou Bakes');

   const other = await call('GET', '/api/contacts', { token: t.bMember });
   assert.ok(!other.body.some((u) => u.email === A.member), 'org B never sees org A members');
});

test('profile validation and directory opt-out', async () => {
   const bad = await call('PUT', '/api/users/me', { token: t.aMember, body: { website: 'javascript:alert(1)' } });
   assert.equal(bad.status, 400);
   const many = await call('PUT', '/api/users/me', { token: t.aMember, body: { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) } });
   assert.equal(many.status, 400);

   // Another member hides themselves; members no longer see them, admins still do.
   const other = await prisma.user.findFirst({ where: { organization: { slug: A.slug }, role: 2, NOT: { email: A.member } } });
   const otherToken = await login(other.email);
   await call('PUT', '/api/users/me', { token: otherToken, body: { showInDirectory: false } });
   const asMember = await call('GET', '/api/contacts', { token: t.aMember });
   assert.ok(!asMember.body.some((u) => u.id === other.id));
   const asAdmin = await call('GET', '/api/contacts', { token: t.aAdmin });
   assert.ok(asAdmin.body.some((u) => u.id === other.id));
   await call('PUT', '/api/users/me', { token: otherToken, body: { showInDirectory: true } });
});

// ---- Notifications --------------------------------------------------------------

test('activity feed records actions, stays per organization, and tracks unread', async () => {
   await call('POST', '/api/notifications/seen', { token: t.aAdmin });
   const zero = await call('GET', '/api/notifications/unread-count', { token: t.aAdmin });
   assert.equal(zero.body.count, 0);

   const email = `feed-${Date.now()}@example.com`;
   const add = await call('POST', '/api/auth/register', { token: t.aAdmin, body: { name: 'Feed Person', email, phone: `555${Date.now()}`.slice(0, 12), role: 2 } });
   assert.equal(add.status, 201, add.raw);

   const feed = await call('GET', '/api/notifications', { token: t.aAdmin });
   assert.equal(feed.status, 200);
   const entry = feed.body.items.find((i) => i.type === 'member_joined' && i.detail === email);
   assert.ok(entry, 'member_joined logged');
   assert.equal(entry.unread, true);
   const one = await call('GET', '/api/notifications/unread-count', { token: t.aAdmin });
   assert.ok(one.body.count >= 1);

   const filtered = await call('GET', '/api/notifications?type=donation', { token: t.aAdmin });
   assert.ok(filtered.body.items.every((i) => i.type === 'donation'));

   const bFeed = await call('GET', '/api/notifications', { token: t.bAdmin });
   assert.ok(!bFeed.body.items.some((i) => i.detail === email), 'org B cannot see org A activity');

   const asMember = await call('GET', '/api/notifications', { token: t.aMember });
   assert.equal(asMember.status, 403);
});

test('RSVP and tier change appear in the feed', async () => {
   const events = await call('GET', '/api/events/user', { token: t.aMember });
   const ev = events.body.upcomingEvents.find((e) => !e.isAttending && e.isRSVP !== false);
   if (ev) {
      const r = await call('POST', '/api/events/rsvp', { token: t.aMember, body: { event_id: ev.id } });
      assert.equal(r.status, 201, r.raw);
   }
   const tier = await prisma.membership.findFirst({ where: { organization: { slug: A.slug } } });
   await call('POST', '/api/users/update_membership', { token: t.aMember, body: { membershipId: tier.id } });
   const feed = await call('GET', '/api/notifications', { token: t.aAdmin });
   if (ev) assert.ok(feed.body.items.some((i) => i.type === 'event_rsvp'));
   assert.ok(feed.body.items.some((i) => i.type === 'membership_changed'));
});

// ---- Messages ----------------------------------------------------------------------

test('each organization gets its own default templates; CRUD stays inside the org', async () => {
   const a = await call('GET', '/api/messages/templates', { token: t.aAdmin });
   assert.equal(a.status, 200);
   assert.ok(a.body.some((x) => x.name === 'Welcome Email'));
   const created = await call('POST', '/api/messages/templates', { token: t.aAdmin, body: { name: 'Gala Invite', subject: 'Gala', body: 'Hi {{first_name}}' } });
   assert.equal(created.status, 201, created.raw);
   const dup = await call('POST', '/api/messages/templates', { token: t.aAdmin, body: { name: 'Gala Invite', subject: 'x', body: 'y' } });
   assert.equal(dup.status, 400);

   const bEdit = await call('PUT', `/api/messages/templates/${created.body.id}`, { token: t.bAdmin, body: { name: 'Hijack', subject: 'x', body: 'y' } });
   assert.equal(bEdit.status, 404);
   const bDel = await call('DELETE', `/api/messages/templates/${created.body.id}`, { token: t.bAdmin });
   assert.equal(bDel.status, 404);
   const memberList = await call('GET', '/api/messages/templates', { token: t.aMember });
   assert.equal(memberList.status, 403);
});

test('audience preview counts only the caller organization', async () => {
   const all = await call('POST', '/api/messages/audience-preview', { token: t.aAdmin, body: { audienceType: 'all_members' } });
   assert.equal(all.status, 200);
   const expected = await prisma.user.count({ where: { organization: { slug: A.slug }, role: 2, status: 1 } });
   assert.equal(all.body.count, expected);

   const bTier = await prisma.membership.findFirst({ where: { organization: { slug: B.slug } } });
   const cross = await call('POST', '/api/messages/audience-preview', { token: t.aAdmin, body: { audienceType: 'tier', audienceRef: { tierId: bTier.id } } });
   assert.equal(cross.status, 400, 'another org tier is not found');

   const bUser = await prisma.user.findFirst({ where: { organization: { slug: B.slug } } });
   const custom = await call('POST', '/api/messages/audience-preview', { token: t.aAdmin, body: { audienceType: 'custom', audienceRef: { userIds: [bUser.id] } } });
   assert.equal(custom.body.count, 0, 'custom picks from another org are dropped');
});

test('without Resend configured, "send" saves the message as ready and sends nothing', async () => {
   assert.equal((await call('GET', '/api/messages/config', { token: t.aAdmin })).body.emailEnabled, false);
   const before = resendBatches.length;
   const r = await call('POST', '/api/messages', {
      token: t.aAdmin,
      body: { subject: 'Hello {{first_name}}', body: 'Welcome to {{organization}}', audienceType: 'all_members', action: 'send' },
   });
   assert.equal(r.status, 201, r.raw);
   assert.equal(r.body.status, 'ready');
   assert.equal(r.body.emailEnabled, false);
   assert.equal(resendBatches.length, before);

   const again = await call('POST', `/api/messages/${r.body.id}/send`, { token: t.aAdmin });
   assert.equal(again.status, 202);
   assert.equal(again.body.status, 'ready');

   const bSees = await call('GET', `/api/messages/${r.body.id}`, { token: t.bAdmin });
   assert.equal(bSees.status, 404);
   const bSend = await call('POST', `/api/messages/${r.body.id}/send`, { token: t.bAdmin });
   assert.equal(bSend.status, 404);
});

test('with Resend configured, messages send with merge fields and track delivery via webhook', async () => {
   env.RESEND_API_KEY = 're_test';
   env.EMAIL_FROM = 'noreply@apperr.test';
   env.RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('resend-secret-for-tests').toString('base64');
   try {
      const draft = await call('POST', '/api/messages', {
         token: t.aAdmin,
         body: { subject: 'Hi {{first_name}}', body: 'Hello {{name}} from {{organization}}', audienceType: 'all_members', action: 'draft' },
      });
      assert.equal(draft.body.status, 'draft');

      const before = resendBatches.length;
      const sent = await call('POST', `/api/messages/${draft.body.id}/send`, { token: t.aAdmin });
      assert.equal(sent.status, 200, sent.raw);
      assert.equal(sent.body.status, 'sent');
      assert.ok(sent.body.sentCount > 0);
      const batch = resendBatches.slice(before).flat();
      assert.equal(batch.length, sent.body.sentCount);
      assert.ok(batch[0].from.startsWith('Bayou City'), batch[0].from);
      assert.ok(!batch[0].subject.includes('{{'), 'merge fields replaced');
      assert.ok(batch.every((e) => e.to[0].endsWith('@bayoucitychamber.org') || !e.to[0].includes('lonestarpros')), 'no org B recipients');

      const twice = await call('POST', `/api/messages/${draft.body.id}/send`, { token: t.aAdmin });
      assert.equal(twice.status, 400, 'cannot send twice');

      // Delivery webhook
      const rec = await prisma.messageRecipient.findFirst({ where: { messageId: draft.body.id } });
      const payload = JSON.stringify({ type: 'email.opened', created_at: new Date().toISOString(), data: { email_id: rec.providerId } });
      const crypto = await import('node:crypto');
      const id = 'msg_1';
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = crypto.createHmac('sha256', Buffer.from('resend-secret-for-tests')).update(`${id}.${ts}.${payload}`).digest('base64');
      const bad = await call('POST', '/api/messages/webhook/resend', { raw: payload, headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': 'v1,AAAA' } });
      assert.equal(bad.status, 400);
      const ok = await call('POST', '/api/messages/webhook/resend', { raw: payload, headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` } });
      assert.equal(ok.status, 200, ok.raw);

      const detail = await call('GET', `/api/messages/${draft.body.id}`, { token: t.aAdmin });
      assert.equal(detail.body.stats.opened, 1);
      assert.equal(detail.body.stats.delivered, 1);

      const feed = await call('GET', '/api/notifications?type=message_sent', { token: t.aAdmin });
      assert.ok(feed.body.items.some((i) => i.meta?.messageId === draft.body.id));
   } finally {
      env.RESEND_API_KEY = '';
      env.EMAIL_FROM = '';
   }
});

test('sent messages cannot be edited or deleted; drafts can', async () => {
   const sentMsg = await prisma.message.findFirst({ where: { status: 'sent', organization: { slug: A.slug } } });
   assert.equal((await call('DELETE', `/api/messages/${sentMsg.id}`, { token: t.aAdmin })).status, 404);
   const d = await call('POST', '/api/messages', { token: t.aAdmin, body: { subject: 'x', body: 'y', audienceType: 'all_members', action: 'draft' } });
   const edit = await call('PUT', `/api/messages/${d.body.id}`, { token: t.aAdmin, body: { subject: 'x2', body: 'y', audienceType: 'members_and_contacts' } });
   assert.equal(edit.status, 200);
   assert.equal(edit.body.audienceLabel, 'All members and contacts');
   assert.equal((await call('DELETE', `/api/messages/${d.body.id}`, { token: t.bAdmin })).status, 404);
   assert.equal((await call('DELETE', `/api/messages/${d.body.id}`, { token: t.aAdmin })).status, 200);
});

// ---- Fundraising -------------------------------------------------------------------

test('admin records an offline gift; totals and campaign progress update; org B sees none of it', async () => {
   const campaigns = await call('GET', '/api/campaign', { token: t.aAdmin });
   const c = campaigns.body[0];
   const startRaised = c.raisedCents;

   const r = await call('POST', '/api/donations', { token: t.aAdmin, body: { amount: '150.50', method: 'check', campaignId: c.id, donorName: 'Jane Donor', note: 'Check #1001' } });
   assert.equal(r.status, 201, r.raw);
   assert.equal(r.body.amountCents, 15050);
   assert.equal(r.body.status, 'succeeded');

   const after = (await call('GET', '/api/campaign', { token: t.aAdmin })).body.find((x) => x.id === c.id);
   assert.equal(after.raisedCents, startRaised + 15050);

   const sum = await call('GET', '/api/donations/summary', { token: t.aAdmin });
   assert.ok(sum.body.totalRaisedCents >= 15050);
   assert.equal(sum.body.monthly.length, 12);

   const bList = await call('GET', '/api/donations', { token: t.bAdmin });
   assert.ok(!bList.body.some((d) => d.id === r.body.id));
   const bCampaign = await call('POST', '/api/donations', { token: t.bAdmin, body: { amount: 10, method: 'cash', campaignId: c.id, donorName: 'X' } });
   assert.equal(bCampaign.status, 404, 'cannot attach a gift to another org campaign');
   const bDel = await call('DELETE', `/api/donations/${r.body.id}`, { token: t.bAdmin });
   assert.equal(bDel.status, 404);

   assert.equal((await call('POST', '/api/donations', { token: t.aAdmin, body: { amount: 10, method: 'stripe', donorName: 'X' } })).status, 400);
   assert.equal((await call('GET', '/api/donations', { token: t.aMember })).status, 403);

   const feed = await call('GET', '/api/notifications?type=donation', { token: t.aAdmin });
   assert.ok(feed.body.items.some((i) => i.meta?.donationId === r.body.id));
});

test('Stripe Connect onboarding: admin connects, status reflects the account', async () => {
   const s0 = await call('GET', '/api/payments/status', { token: t.aAdmin });
   assert.equal(s0.body.stripeConfigured, true);
   assert.equal(s0.body.connected, false);

   assert.equal((await call('GET', '/api/donations/availability', { token: t.aMember })).body.acceptingDonations, false);
   const before = await call('POST', '/api/donations/checkout', { token: t.aMember, body: { amount: 25 } });
   assert.equal(before.status, 400, 'no online gifts until connected');

   const c = await call('POST', '/api/payments/connect', { token: t.aAdmin });
   assert.equal(c.status, 200, c.raw);
   assert.equal(c.body.url, 'https://connect.stripe.test/setup/abc');
   const link = stripeCalls.find((x) => x[0] === 'accountLinks.create')[1];
   assert.ok(link.return_url.startsWith('https://app.example.test/settings'));

   const s1 = await call('GET', '/api/payments/status', { token: t.aAdmin });
   assert.equal(s1.body.connected, true);
   assert.equal(s1.body.chargesEnabled, true, 'refreshed from Stripe');

   assert.equal((await call('POST', '/api/payments/connect', { token: t.aMember })).status, 403);
   assert.equal((await call('GET', '/api/donations/availability', { token: t.aMember })).body.acceptingDonations, true);
   const s2 = await call('GET', '/api/payments/status', { token: t.bAdmin });
   assert.equal(s2.body.connected, false, 'org B is unaffected');
});

test('member donates online: checkout goes to the org account, webhook marks it paid once', async () => {
   const org = await prisma.organization.findUnique({ where: { slug: A.slug } });
   const campaign = (await call('GET', '/api/campaign', { token: t.aMember })).body[0];

   const r = await call('POST', '/api/donations/checkout', { token: t.aMember, body: { amount: 50, campaignId: campaign.id } });
   assert.equal(r.status, 200, r.raw);
   assert.equal(r.body.url, 'https://checkout.stripe.test/pay');
   const [, params, opts] = stripeCalls.filter((x) => x[0] === 'checkout.sessions.create').at(-1);
   assert.equal(params.payment_intent_data.transfer_data.destination, org.stripeAccountId);
   assert.equal(params.line_items[0].price_data.unit_amount, 5000);
   assert.equal(params.payment_intent_data.application_fee_amount, undefined, 'no platform fee by default');
   assert.ok(opts.idempotencyKey);

   const donation = await prisma.donation.findFirst({ where: { organizationId: org.id, method: 'stripe' }, orderBy: { id: 'desc' } });
   assert.equal(donation.status, 'pending');

   const event = {
      id: 'evt_1', object: 'event', type: 'checkout.session.completed',
      data: { object: { id: donation.stripeSessionId, object: 'checkout.session', payment_status: 'paid', payment_intent: 'pi_test_1', metadata: { donationId: String(donation.id), organizationId: String(org.id) } } },
   };
   const payload = JSON.stringify(event);
   const badSig = await call('POST', '/api/payments/webhook', { raw: payload, headers: { 'stripe-signature': 't=1,v1=bad' } });
   assert.equal(badSig.status, 400);
   const header = realWebhooks.generateTestHeaderString({ payload, secret: 'whsec_test_platform' });
   for (let i = 0; i < 2; i++) {
      const ok = await call('POST', '/api/payments/webhook', { raw: payload, headers: { 'stripe-signature': header, 'content-type': 'application/json' } });
      assert.equal(ok.status, 200, ok.raw);
   }
   const paid = await prisma.donation.findUnique({ where: { id: donation.id } });
   assert.equal(paid.status, 'succeeded');
   assert.equal(paid.stripePaymentIntentId, 'pi_test_1');
   const logs = await prisma.activity.count({ where: { organizationId: org.id, type: 'donation', meta: { path: ['donationId'], equals: donation.id } } });
   assert.equal(logs, 1, 'a retried webhook does not double count');

   const mine = await call('GET', '/api/donations/mine', { token: t.aMember });
   assert.ok(mine.body.some((d) => d.id === donation.id));

   // Refund
   const refund = JSON.stringify({ id: 'evt_2', object: 'event', type: 'charge.refunded', data: { object: { id: 'ch_1', object: 'charge', refunded: true, payment_intent: 'pi_test_1' } } });
   await call('POST', '/api/payments/webhook', { raw: refund, headers: { 'stripe-signature': realWebhooks.generateTestHeaderString({ payload: refund, secret: 'whsec_test_platform' }) } });
   assert.equal((await prisma.donation.findUnique({ where: { id: donation.id } })).status, 'refunded');
});

test('amount rules: minimum, and suggested-only campaigns', async () => {
   assert.equal((await call('POST', '/api/donations/checkout', { token: t.aMember, body: { amount: 0.5 } })).status, 400);
   const org = await prisma.organization.findUnique({ where: { slug: A.slug } });
   const fixed = await prisma.campaign.create({
      data: { organizationId: org.id, name: `Fixed ${Date.now()}`, slug: `fixed-${Date.now()}`, goal: 1000, date: new Date(), donation_amount: [25, 50], capacity: 0, description: 'x', isCustomAmount: false, isPublic: true, isAnonymous: false, isEmailNotifiy: false, isRecurring: false, thank_you: 'Thanks' },
   });
   assert.equal((await call('POST', '/api/donations/checkout', { token: t.aMember, body: { amount: 30, campaignId: fixed.id } })).status, 400);
   assert.equal((await call('POST', '/api/donations/checkout', { token: t.aMember, body: { amount: 25, campaignId: fixed.id } })).status, 200);
   // Member of org B cannot donate to an org A campaign through their own login
   assert.equal((await call('POST', '/api/donations/checkout', { token: t.bMember, body: { amount: 25, campaignId: fixed.id } })).status, 400);
});

test('public campaign page and guest checkout; private campaigns are hidden', async () => {
   const org = await prisma.organization.findUnique({ where: { slug: A.slug } });
   const pub = await prisma.campaign.findFirst({ where: { organizationId: org.id, isPublic: true } });
   const priv = await prisma.campaign.findFirst({ where: { organizationId: org.id, isPublic: false } });

   const page = await call('GET', `/api/public/${A.slug}/campaigns/${pub.slug}`);
   assert.equal(page.status, 200, page.raw);
   assert.equal(page.body.acceptingDonations, true);
   assert.equal(page.body.organization.name, org.name);
   assert.equal(page.body.organization.stripeAccountId, undefined);

   if (priv) assert.equal((await call('GET', `/api/public/${A.slug}/campaigns/${priv.slug}`)).status, 404);
   assert.equal((await call('GET', `/api/public/${B.slug}/campaigns/${pub.slug}`)).status, 404, 'slug under the wrong org');

   const noEmail = await call('POST', `/api/public/${A.slug}/campaigns/${pub.slug}/checkout`, { body: { amount: 20, donorName: 'Guest' } });
   assert.equal(noEmail.status, 400);
   const ok = await call('POST', `/api/public/${A.slug}/campaigns/${pub.slug}/checkout`, { body: { amount: 20, donorName: 'Guest', donorEmail: 'guest@example.com' } });
   assert.equal(ok.status, 200, ok.raw);

   const bPub = await prisma.campaign.findFirst({ where: { organization: { slug: B.slug }, isPublic: true } });
   if (bPub) {
      const notConnected = await call('GET', `/api/public/${B.slug}/campaigns/${bPub.slug}`);
      assert.equal(notConnected.body.acceptingDonations, false);
   }
});

test('platform admin sets a fee; checkout then includes the application fee', async () => {
   const id = await orgId(A.slug);
   assert.equal((await call('PUT', `/api/platform/organizations/${id}/fee`, { token: t.aAdmin, body: { platformFeePercent: 5 } })).status, 403);
   const r = await call('PUT', `/api/platform/organizations/${id}/fee`, { token: t.platform, body: { platformFeePercent: 2.5 } });
   assert.equal(r.status, 200, r.raw);
   await call('POST', '/api/donations/checkout', { token: t.aMember, body: { amount: 100 } });
   const [, params] = stripeCalls.filter((x) => x[0] === 'checkout.sessions.create').at(-1);
   assert.equal(params.payment_intent_data.application_fee_amount, 250);
   await call('PUT', `/api/platform/organizations/${id}/fee`, { token: t.platform, body: { platformFeePercent: 0 } });
});
