// Tenant isolation and permission tests. Runs the real Express app against
// a real Postgres database that has been migrated and seeded:
//
//   DATABASE_URL=... DIRECT_URL=... JWT_SECRET=... npx prisma migrate deploy
//   node prisma/seed.js
//   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { default: app } = await import('../src/app.js');
const { prisma, forTenant } = await import('../src/config/db.js');

const PASSWORD = process.env.SEED_PASSWORD || 'Demo@2026!';
const A = { admin: 'admin@bayoucitychamber.org', member: 'monique@bayoucitychamber.org' };
const B = { admin: 'admin@lonestarpros.org', member: 'evelyn@lonestarpros.org' };
const PLATFORM = (process.env.SEED_PLATFORM_EMAIL || 'admin@associationos.app').toLowerCase();

let server, base;
const tokens = {};

async function call(method, path, { token, body } = {}) {
   const res = await fetch(base + path, {
      method,
      headers: {
         'Content-Type': 'application/json',
         ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
   });
   const text = await res.text();
   let json;
   try { json = JSON.parse(text); } catch { json = text; }
   return { status: res.status, body: json, raw: text };
}

async function login(email) {
   const r = await call('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
   assert.equal(r.status, 200, `login ${email}: ${r.raw}`);
   return r.body;
}

const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

before(async () => {
   server = app.listen(0);
   await new Promise((r) => server.once('listening', r));
   base = `http://127.0.0.1:${server.address().port}`;
   for (const [k, email] of Object.entries({ aAdmin: A.admin, aMember: A.member, bAdmin: B.admin, bMember: B.member, platform: PLATFORM })) {
      tokens[k] = (await login(email)).accessToken;
   }
});

after(async () => {
   server.close();
   await prisma.$disconnect();
});

test('health check', async () => {
   const r = await call('GET', '/api/health');
   assert.equal(r.status, 200);
   assert.equal(r.body.ok, true);
});

test('login returns organization branding and token carries organizationId', async () => {
   const a = await login(A.admin);
   const b = await login(B.admin);
   assert.equal(a.organization.slug, 'bayou-city-chamber');
   assert.equal(b.organization.slug, 'lone-star-pros');
   assert.ok(claims(a.accessToken).organizationId);
   assert.notEqual(claims(a.accessToken).organizationId, claims(b.accessToken).organizationId);
   assert.ok(a.refreshToken, 'raw refresh token returned');
});

test('wrong password and unknown email give the same answer', async () => {
   const r1 = await call('POST', '/api/auth/login', { body: { email: A.admin, password: 'nope' } });
   const r2 = await call('POST', '/api/auth/login', { body: { email: 'nobody@x.com', password: 'nope' } });
   assert.equal(r1.status, 401);
   assert.equal(r2.status, 401);
   assert.equal(r1.body.message, r2.body.message);
});

test('T03: contacts list only shows the caller organization, with no password fields', async () => {
   const a = await call('GET', '/api/contacts', { token: tokens.aAdmin });
   const b = await call('GET', '/api/contacts', { token: tokens.bAdmin });
   assert.equal(a.status, 200);
   assert.ok(a.body.length > 0 && b.body.length > 0);
   assert.ok(!a.body.some((u) => u.email.endsWith('@lonestarpros.org')), 'A sees no B people');
   assert.ok(!b.body.some((u) => u.email.endsWith('@bayoucitychamber.org')), 'B sees no A people');
   assert.ok(a.body.some((u) => u.email === A.member));
   assert.ok(!a.raw.toLowerCase().includes('password'), 'T08: no password in response');
});

test('T08: no password hashes in events, dashboard or user payloads', async () => {
   for (const [path, token] of [['/api/events', tokens.aAdmin], ['/api/dashboard', tokens.aAdmin], ['/api/events/user', tokens.aMember], ['/api/users', tokens.aMember], ['/api/users/me', tokens.aMember]]) {
      const r = await call('GET', path, { token });
      assert.equal(r.status, 200, path);
      assert.ok(!r.raw.includes('$2a$') && !r.raw.includes('$2b$') && !r.raw.toLowerCase().includes('"password"'), `${path} leaks a hash`);
   }
});

test('T04: org A cannot edit or see org B events by id', async () => {
   const bEvents = (await call('GET', '/api/events', { token: tokens.bAdmin })).body;
   const target = bEvents[0];
   const r = await call('PUT', `/api/events/${target.id}`, {
      token: tokens.aAdmin,
      body: { title: 'Hacked', date: '2030-01-01', description: 'x' },
   });
   assert.equal(r.status, 404);
   const after = (await call('GET', '/api/events', { token: tokens.bAdmin })).body.find((e) => e.id === target.id);
   assert.equal(after.title, target.title);

   const aEvents = (await call('GET', '/api/events', { token: tokens.aAdmin })).body;
   assert.ok(!aEvents.some((e) => e.id === target.id));
});

test('org A admin cannot edit an org B person by id', async () => {
   const bPeople = (await call('GET', '/api/contacts', { token: tokens.bAdmin })).body;
   const r = await call('PUT', `/api/auth/register/${bPeople[0].id}`, { token: tokens.aAdmin, body: { name: 'Hacked' } });
   assert.equal(r.status, 404);
});

test('members cannot RSVP to or join tiers of another organization', async () => {
   const bEvent = (await call('GET', '/api/events', { token: tokens.bAdmin })).body[0];
   const rsvp = await call('POST', '/api/events/rsvp', { token: tokens.aMember, body: { event_id: bEvent.id } });
   assert.equal(rsvp.status, 404);

   const bTier = (await call('GET', '/api/memberships', { token: tokens.bAdmin })).body[0];
   const join = await call('POST', '/api/users/update_membership', { token: tokens.aMember, body: { membershipId: bTier.id } });
   assert.equal(join.status, 404);
});

test('T06/T07: permissions on admin endpoints', async () => {
   const noAuth = await call('POST', '/api/auth/register', { body: { name: 'x', email: 'x@x.com', phone: '1', role: 1 } });
   assert.equal(noAuth.status, 401);
   const member = await call('POST', '/api/auth/register', { token: tokens.aMember, body: { name: 'x', email: 'x@x.com', phone: '1', role: 1 } });
   assert.equal(member.status, 403);
   const ev = await call('POST', '/api/events', { token: tokens.aMember, body: { title: 'x', date: '2030-01-01' } });
   assert.equal(ev.status, 403);
   const tier = await call('POST', '/api/memberships', { token: tokens.aMember, body: { name: 'x' } });
   assert.equal(tier.status, 403);
   const camp = await call('POST', '/api/campaign', { token: tokens.aMember, body: { name: 'x', date: '2030-01-01' } });
   assert.equal(camp.status, 403);
   const bulk = await call('POST', '/api/auth/bulk_register', { body: { users: [{ email: 'y@y.com', phone: '2' }] } });
   assert.equal(bulk.status, 401);
});

test('T15: same event title can exist in two organizations', async () => {
   const title = `Isolation Test Event ${Date.now()}`;
   const a = await call('POST', '/api/events', { token: tokens.aAdmin, body: { title, date: '2030-02-01', description: 'a' } });
   const b = await call('POST', '/api/events', { token: tokens.bAdmin, body: { title, date: '2030-02-01', description: 'b' } });
   assert.equal(a.status, 201, a.raw);
   assert.equal(b.status, 201, b.raw);
   assert.notEqual(a.body.organizationId, b.body.organizationId);
   const dup = await call('POST', '/api/events', { token: tokens.aAdmin, body: { title, date: '2030-02-01' } });
   assert.equal(dup.status, 400);
});

test('admin adds and edits a contact inside their own organization', async () => {
   const email = `new.${Date.now()}@example.com`;
   const c = await call('POST', '/api/auth/register', { token: tokens.aAdmin, body: { name: 'New Person', email, phone: `9${Date.now()}`.slice(-10), role: 2 } });
   assert.equal(c.status, 201, c.raw);
   assert.equal(c.body.organizationId, claims(tokens.aAdmin).organizationId);
   assert.equal(c.body.password, undefined);
   const e = await call('PUT', `/api/auth/register/${c.body.id}`, { token: tokens.aAdmin, body: { name: 'Renamed Person' } });
   assert.equal(e.status, 200);
   assert.equal(e.body.name, 'Renamed Person');
   assert.equal(e.body.role, 2, 'role unchanged when not sent');
   const bList = (await call('GET', '/api/contacts', { token: tokens.bAdmin })).body;
   assert.ok(!bList.some((u) => u.email === email));
});

test('bulk import lands in the caller organization and skips emails used elsewhere', async () => {
   const stamp = Date.now();
   const r = await call('POST', '/api/auth/bulk_register', {
      token: tokens.aAdmin,
      body: { users: [
         { name: 'Import One', email: `imp1.${stamp}@example.com`, phone: `81${stamp}`.slice(-10), role: 3 },
         { name: 'Clash', email: B.member, phone: '8888888888', role: 3 },
      ] },
   });
   assert.equal(r.status, 200, r.raw);
   assert.equal(r.body.count, 1);
   assert.equal(r.body.skipped, 1);
});

test('member RSVP and cancel within their organization', async () => {
   const ev = await call('POST', '/api/events', { token: tokens.aAdmin, body: { title: `RSVP Test ${Date.now()}`, date: '2030-03-01', description: 'r', isRSVP: true } });
   const r1 = await call('POST', '/api/events/rsvp', { token: tokens.aMember, body: { event_id: ev.body.id } });
   assert.equal(r1.status, 201, r1.raw);
   const again = await call('POST', '/api/events/rsvp', { token: tokens.aMember, body: { event_id: ev.body.id } });
   assert.equal(again.status, 400);
   const del = await call('DELETE', `/api/events/rsvp/${ev.body.id}`, { token: tokens.aMember });
   assert.equal(del.status, 200);
});

test('member picks a tier in their organization and history is recorded', async () => {
   const tiers = (await call('GET', '/api/memberships', { token: tokens.aMember })).body;
   const r = await call('POST', '/api/users/update_membership', { token: tokens.aMember, body: { membershipId: tiers[0].id } });
   assert.equal(r.status, 200, r.raw);
   const dash = (await call('GET', '/api/users', { token: tokens.aMember })).body;
   assert.equal(dash.membership.id, tiers[0].id);
   assert.equal(dash.membershipHistory.membershipId, tiers[0].id);
});

test('dashboard counts only the caller organization', async () => {
   const a = (await call('GET', '/api/dashboard', { token: tokens.aAdmin })).body;
   const aMembers = (await call('GET', '/api/contacts', { token: tokens.aAdmin })).body.filter((u) => u.role === 2).length;
   assert.equal(a.members_count, aMembers);
   assert.ok(Array.isArray(a.recentActivity) && a.recentActivity.length > 0);
   assert.ok(Array.isArray(a.expiringSoon));
   assert.ok(a.expiringSoon.every((h) => h.user.email.endsWith('@bayoucitychamber.org')));
   const b = (await call('GET', '/api/dashboard', { token: tokens.bAdmin })).body;
   assert.notEqual(a.members_count, b.members_count);
});

test('campaign create and list stay inside the organization', async () => {
   const name = `Campaign ${Date.now()}`;
   const c = await call('POST', '/api/campaign', { token: tokens.aAdmin, body: { name, date: '2030-04-01', goal: 1000 } });
   assert.equal(c.status, 201, c.raw);
   const bList = (await call('GET', '/api/campaign', { token: tokens.bAdmin })).body;
   assert.ok(!bList.some((x) => x.name === name));
});

test('campaign edit: own org works, other org and members cannot', async () => {
   const name = `Editable ${Date.now()}`;
   const c = await call('POST', '/api/campaign', { token: tokens.aAdmin, body: { name, date: '2030-05-01', goal: 500 } });
   assert.equal(c.status, 201, c.raw);
   const body = { name: `${name} v2`, date: '2030-06-01', goal: 900 };
   const ok = await call('PUT', `/api/campaign/${c.body.id}`, { token: tokens.aAdmin, body });
   assert.equal(ok.status, 200, ok.raw);
   assert.equal(ok.body.goal, 900);
   assert.equal(ok.body.name, `${name} v2`);
   const other = await call('PUT', `/api/campaign/${c.body.id}`, { token: tokens.bAdmin, body: { ...body, name: 'hijack' } });
   assert.equal(other.status, 404, other.raw);
   const member = await call('PUT', `/api/campaign/${c.body.id}`, { token: tokens.aMember, body });
   assert.equal(member.status, 403, member.raw);
});

test('T21: refresh rotates tokens and detects reuse', async () => {
   const s = await login(A.member);
   const r1 = await call('POST', '/api/auth/refresh', { body: { refreshToken: s.refreshToken } });
   assert.equal(r1.status, 200, r1.raw);
   assert.equal(claims(r1.body.accessToken).organizationId, claims(s.accessToken).organizationId);
   assert.ok(r1.body.refreshToken && r1.body.refreshToken !== s.refreshToken);
   const reuse = await call('POST', '/api/auth/refresh', { body: { refreshToken: s.refreshToken } });
   assert.equal(reuse.status, 401);
});

test('organization branding endpoints', async () => {
   const cur = await call('GET', '/api/organizations/current', { token: tokens.aMember });
   assert.equal(cur.body.slug, 'bayou-city-chamber');
   const pub = await call('GET', '/api/organizations/public/lone-star-pros');
   assert.equal(pub.status, 200);
   assert.equal(pub.body.name, 'Lone Star Professionals Association');
   const memberEdit = await call('PUT', '/api/organizations/current', { token: tokens.aMember, body: { name: 'x' } });
   assert.equal(memberEdit.status, 403);
});

test('T25: platform admin creates an organization and gets a single-use invite link', async () => {
   const denied = await call('POST', '/api/platform/organizations', { token: tokens.aAdmin, body: { name: 'Nope', contactEmail: 'n@n.org' } });
   assert.equal(denied.status, 403);

   const stamp = Date.now();
   const email = `owner.${stamp}@neworg.org`;
   const r = await call('POST', '/api/platform/organizations', {
      token: tokens.platform,
      body: { name: `New Org ${stamp}`, primaryColor: '#123456', contactName: 'Owner', contactEmail: email, contactPhone: '7135550199' },
   });
   assert.equal(r.status, 201, r.raw);
   assert.ok(r.body.invite.token, 'raw token returned once');
   assert.equal(r.body.invite.status, 'pending');
   assert.ok(!r.raw.includes('tokenHash'), 'hash never returned');

   const info = await call('GET', `/api/onboarding/invites/${r.body.invite.token}`);
   assert.equal(info.status, 200, info.raw);
   assert.equal(info.body.email, email);
   assert.equal(info.body.organization.primaryColor, '#123456');

   const acc = await call('POST', `/api/onboarding/invites/${r.body.invite.token}/accept`, { body: { name: 'Owner One', phone: '7135550199', password: 'Str0ngPass!' } });
   assert.equal(acc.status, 201, acc.raw);
   assert.ok(acc.body.accessToken && acc.body.refreshToken);
   assert.equal(acc.body.user.role, 1);
   assert.equal(acc.body.organization.onboardedAt, null, 'new org still needs welcome setup');

   const again = await call('POST', `/api/onboarding/invites/${r.body.invite.token}/accept`, { body: { name: 'X', phone: '1', password: 'Another1!' } });
   assert.equal(again.status, 410, 'single use');

   const s = await call('POST', '/api/auth/login', { body: { email, password: 'Str0ngPass!' } });
   assert.equal(s.status, 200);
   const contacts = await call('GET', '/api/contacts', { token: s.body.accessToken });
   assert.deepEqual(contacts.body, []);

   const done = await call('POST', '/api/organizations/current/onboarding-complete', { token: s.body.accessToken });
   assert.equal(done.status, 200);
   assert.ok(done.body.onboardedAt);

   const list = await call('GET', '/api/platform/organizations', { token: tokens.platform });
   const row = list.body.find((o) => o.contactEmail === email);
   assert.equal(row.latestInvite.status, 'used');
});

test('public sign-up creates a pending application that cannot log in until approved', async () => {
   const stamp = Date.now();
   const email = `apply.${stamp}@chamber.org`;
   const bad = await call('POST', '/api/onboarding/signup', { body: { organizationName: 'X' } });
   assert.equal(bad.status, 400);

   const r = await call('POST', '/api/onboarding/signup', {
      body: { organizationName: `Applicant Chamber ${stamp}`, contactName: 'Pat Applicant', contactEmail: email, contactPhone: '2815550100' },
   });
   assert.equal(r.status, 201, r.raw);
   const dup = await call('POST', '/api/onboarding/signup', {
      body: { organizationName: `Applicant Chamber ${stamp}`, contactName: 'Pat', contactEmail: email, contactPhone: '1' },
   });
   assert.equal(dup.status, 400, 'one pending application per email');

   const usedEmail = await call('POST', '/api/onboarding/signup', {
      body: { organizationName: 'Taken', contactName: 'T', contactEmail: A.admin, contactPhone: '1' },
   });
   assert.equal(usedEmail.status, 400, 'existing account email refused');

   const honeypot = await call('POST', '/api/onboarding/signup', {
      body: { organizationName: 'Bot Org', contactName: 'Bot', contactEmail: `bot.${stamp}@x.org`, contactPhone: '1', website: 'http://spam' },
   });
   assert.equal(honeypot.status, 201);

   const pending = (await call('GET', '/api/platform/organizations?status=2', { token: tokens.platform })).body;
   const app = pending.find((o) => o.contactEmail === email);
   assert.ok(app, 'shows in the approval queue');
   assert.equal(app.status, 2);
   assert.ok(!pending.some((o) => o.contactEmail === `bot.${stamp}@x.org`), 'honeypot submission not stored');

   const notYet = await call('POST', `/api/platform/organizations/${app.id}/invites`, { token: tokens.platform });
   assert.equal(notYet.status, 400, 'no invite before approval');

   const memberTry = await call('POST', `/api/platform/organizations/${app.id}/approve`, { token: tokens.aAdmin });
   assert.equal(memberTry.status, 403, 'only platform admins approve');

   const ok = await call('POST', `/api/platform/organizations/${app.id}/approve`, { token: tokens.platform });
   assert.equal(ok.status, 200, ok.raw);
   assert.equal(ok.body.organization.status, 1);
   const first = ok.body.invite.token;

   // Regenerating kills the old link.
   const regen = await call('POST', `/api/platform/organizations/${app.id}/invites`, { token: tokens.platform });
   assert.equal(regen.status, 200, regen.raw);
   const oldLink = await call('GET', `/api/onboarding/invites/${first}`);
   assert.equal(oldLink.status, 410);
   assert.equal(oldLink.body.status, 'revoked');
   const newLink = await call('GET', `/api/onboarding/invites/${regen.body.invite.token}`);
   assert.equal(newLink.status, 200);
   assert.equal(newLink.body.phone, '2815550100', 'phone prefilled from the application');

   const twiceApprove = await call('POST', `/api/platform/organizations/${app.id}/approve`, { token: tokens.platform });
   assert.equal(twiceApprove.status, 400);
});

test('rejecting an application; garbage and expired invite links are refused', async () => {
   const stamp = Date.now();
   await call('POST', '/api/onboarding/signup', {
      body: { organizationName: `Reject Me ${stamp}`, contactName: 'R', contactEmail: `rej.${stamp}@x.org`, contactPhone: '1' },
   });
   const app = (await call('GET', '/api/platform/organizations?status=2', { token: tokens.platform })).body.find((o) => o.contactEmail === `rej.${stamp}@x.org`);
   const rej = await call('POST', `/api/platform/organizations/${app.id}/reject`, { token: tokens.platform, body: { reason: 'Not a membership org' } });
   assert.equal(rej.status, 200);
   assert.equal(rej.body.organization.status, 3);
   assert.equal(rej.body.organization.rejectionReason, 'Not a membership org');

   const garbage = await call('GET', '/api/onboarding/invites/not-a-real-token');
   assert.equal(garbage.status, 404);

   // Expire an invite directly and confirm it's refused.
   const created = await call('POST', '/api/platform/organizations', {
      token: tokens.platform,
      body: { name: `Expiring Org ${stamp}`, contactName: 'E', contactEmail: `exp.${stamp}@x.org`, contactPhone: '1' },
   });
   await prisma.invite.update({ where: { id: created.body.invite.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
   const expired = await call('POST', `/api/onboarding/invites/${created.body.invite.token}/accept`, { body: { name: 'E', phone: '1', password: 'Password123' } });
   assert.equal(expired.status, 410);
   assert.equal(expired.body.status, 'expired');
   const list = (await call('GET', '/api/platform/organizations', { token: tokens.platform })).body;
   assert.equal(list.find((o) => o.contactEmail === `exp.${stamp}@x.org`).latestInvite.status, 'expired');
});

test('tenant client refuses cross-tenant writes at the data layer', async () => {
   const orgA = claims(tokens.aAdmin).organizationId;
   const orgB = claims(tokens.bAdmin).organizationId;
   const db = forTenant(orgA);
   const events = await db.event.findMany();
   assert.ok(events.length > 0 && events.every((e) => e.organizationId === orgA));
   await assert.rejects(() => db.campaign.create({ data: { organizationId: orgB, name: 'x', slug: 'x', goal: 0, date: new Date(), capacity: 0, description: '', isCustomAmount: false, isPublic: false, isAnonymous: false, isEmailNotifiy: false, isRecurring: false, thank_you: '' } }), /another organization/);
   await assert.rejects(() => db.event.updateMany({ where: {}, data: { organizationId: orgB } }), /cannot be changed/);
   assert.throws(() => forTenant(undefined), /organization context/);
});

test('tokens without an organization are rejected', async () => {
   const jwt = (await import('jsonwebtoken')).default;
   const legacy = jwt.sign({ id: 1, email: 'x', role: 1 }, process.env.JWT_SECRET);
   const r = await call('GET', '/api/contacts', { token: legacy });
   assert.equal(r.status, 401);
});

test('users update their own profile and password', async () => {
   const email = `self.${Date.now()}@example.com`;
   const c = await call('POST', '/api/auth/register', { token: tokens.aAdmin, body: { name: 'Self Edit', email, phone: `7${Date.now()}`.slice(-10), role: 2, password: 'FirstPass1!' } });
   assert.equal(c.status, 201, c.raw);
   const s = await login2(email, 'FirstPass1!');
   const r = await call('PUT', '/api/users/me', { token: s.accessToken, body: { name: 'Self Edited' } });
   assert.equal(r.status, 200);
   assert.equal(r.body.name, 'Self Edited');
   const bad = await call('PUT', '/api/users/me', { token: s.accessToken, body: { currentPassword: 'wrong', newPassword: 'SecondPass2!' } });
   assert.equal(bad.status, 400);
   const good = await call('PUT', '/api/users/me', { token: s.accessToken, body: { currentPassword: 'FirstPass1!', newPassword: 'SecondPass2!' } });
   assert.equal(good.status, 200);
   await login2(email, 'SecondPass2!');
});

async function login2(email, password) {
   const r = await call('POST', '/api/auth/login', { body: { email, password } });
   assert.equal(r.status, 200, r.raw);
   return r.body;
}
