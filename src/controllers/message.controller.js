import { prisma } from '../config/db.js';
import { ROLES } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';
import {
   emailEnabled, sendBatch, verifyMailgunSignature, normalizeMessageId, BATCH_SIZE,
} from '../utils/email.js';

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

// Every organization starts with these. Admins can edit or delete them.
export const DEFAULT_TEMPLATES = [
   {
      name: 'Blank Message',
      subject: '',
      body: 'Hi {{first_name}},\n\n\n\nThank you,\n{{organization}}',
   },
   {
      name: 'Welcome Email',
      subject: 'Welcome to {{organization}}!',
      body: 'Hi {{first_name}},\n\nWelcome to {{organization}}! We are glad to have you as a member.\n\nLog in any time to see upcoming events, update your directory profile, and connect with other members.\n\nSee you soon,\n{{organization}}',
   },
   {
      name: 'Dues Reminder',
      subject: 'Your {{organization}} membership is up for renewal',
      body: 'Hi {{first_name}},\n\nThis is a friendly reminder that your membership with {{organization}} is due for renewal.\n\nLog in to review your membership tier and renew.\n\nThank you for being part of our community,\n{{organization}}',
   },
   {
      name: 'New Event',
      subject: 'You are invited: [event name]',
      body: 'Hi {{first_name}},\n\nWe are hosting [event name] on [date] at [location].\n\nLog in to RSVP and save your spot.\n\nHope to see you there,\n{{organization}}',
   },
   {
      name: 'Event Reminder',
      subject: 'Reminder: [event name] is coming up',
      body: 'Hi {{first_name}},\n\nJust a reminder that [event name] is on [date] at [location].\n\nWe look forward to seeing you,\n{{organization}}',
   },
];

async function ensureDefaultTemplates(db) {
   const count = await db.messageTemplate.count();
   if (count === 0) {
      await db.messageTemplate.createMany({ data: DEFAULT_TEMPLATES, skipDuplicates: true });
   }
}

function templateData(b) {
   const name = typeof b.name === 'string' ? b.name.trim() : '';
   if (!name) return { error: 'Template name is required' };
   if (name.length > 100) return { error: 'Template name is too long' };
   const subject = typeof b.subject === 'string' ? b.subject.trim().slice(0, 200) : '';
   const body = typeof b.body === 'string' ? b.body.slice(0, 20000) : '';
   if (!body.trim()) return { error: 'Template body is required' };
   return { data: { name, subject, body } };
}

export const listTemplates = async (req, res) => {
   await ensureDefaultTemplates(req.db);
   const templates = await req.db.messageTemplate.findMany({ orderBy: { id: 'asc' } });
   res.json(templates);
};

export const createTemplate = async (req, res) => {
   const { data, error } = templateData(req.body);
   if (error) return res.status(400).json({ message: error });
   const clash = await req.db.messageTemplate.findFirst({ where: { name: data.name }, select: { id: true } });
   if (clash) return res.status(400).json({ message: 'A template with this name already exists' });
   const t = await req.db.messageTemplate.create({ data });
   res.status(201).json(t);
};

export const updateTemplate = async (req, res) => {
   const id = Number(req.params.id);
   if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
   const { data, error } = templateData(req.body);
   if (error) return res.status(400).json({ message: error });
   const current = await req.db.messageTemplate.findFirst({ where: { id }, select: { id: true } });
   if (!current) return res.status(404).json({ message: 'Template not found' });
   const clash = await req.db.messageTemplate.findFirst({ where: { name: data.name }, select: { id: true } });
   if (clash && clash.id !== id) return res.status(400).json({ message: 'A template with this name already exists' });
   const t = await req.db.messageTemplate.update({ where: { id }, data });
   res.json(t);
};

export const deleteTemplate = async (req, res) => {
   const id = Number(req.params.id);
   if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
   const { count } = await req.db.messageTemplate.deleteMany({ where: { id } });
   if (!count) return res.status(404).json({ message: 'Template not found' });
   res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// Audiences
// ---------------------------------------------------------------------------

export const AUDIENCE_TYPES = ['all_members', 'members_and_contacts', 'tier', 'event_attendees', 'custom'];

// Resolves an audience to { label, people: [{ id, name, email }] }, or { error }.
export async function resolveAudience(db, audienceType, audienceRef = {}) {
   const base = { status: 1 };
   const select = { id: true, name: true, email: true };
   switch (audienceType) {
      case 'all_members': {
         const people = await db.user.findMany({ where: { ...base, role: ROLES.MEMBER }, select });
         return { label: 'All members', people };
      }
      case 'members_and_contacts': {
         const people = await db.user.findMany({ where: { ...base, role: { in: [ROLES.MEMBER, ROLES.CONTACT] } }, select });
         return { label: 'All members and contacts', people };
      }
      case 'tier': {
         const tierId = Number(audienceRef?.tierId);
         const tier = Number.isInteger(tierId) ? await db.membership.findFirst({ where: { id: tierId }, select: { id: true, name: true } }) : null;
         if (!tier) return { error: 'Choose a membership tier' };
         const people = await db.user.findMany({ where: { ...base, membershipId: tier.id }, select });
         return { label: `${tier.name || 'Tier'} members`, people };
      }
      case 'event_attendees': {
         const eventId = Number(audienceRef?.eventId);
         const event = Number.isInteger(eventId) ? await db.event.findFirst({ where: { id: eventId }, select: { id: true, title: true } }) : null;
         if (!event) return { error: 'Choose an event' };
         const rsvps = await db.rsvp.findMany({ where: { event_id: event.id }, select: { user: { select: { ...select, status: true } } } });
         const people = rsvps.map((r) => r.user).filter((u) => u && u.status === 1).map(({ status, ...u }) => u);
         return { label: `Attendees of ${event.title}`, people };
      }
      case 'custom': {
         const ids = (Array.isArray(audienceRef?.userIds) ? audienceRef.userIds : []).map(Number).filter(Number.isInteger);
         if (!ids.length) return { error: 'Choose at least one recipient' };
         const people = await db.user.findMany({ where: { ...base, id: { in: ids.slice(0, 5000) } }, select });
         const label = people.length === 1 ? people[0].name || people[0].email : `${people.length} selected people`;
         return { label, people };
      }
      default:
         return { error: 'Choose an audience' };
   }
}

const dedupe = (people) => {
   const seen = new Set();
   return people.filter((p) => {
      const e = (p.email || '').toLowerCase();
      if (!e || seen.has(e)) return false;
      seen.add(e);
      return true;
   });
};

// POST /api/messages/audience-preview { audienceType, audienceRef }
export const previewAudience = async (req, res) => {
   const r = await resolveAudience(req.db, req.body.audienceType, req.body.audienceRef);
   if (r.error) return res.status(400).json({ message: r.error });
   res.json({ label: r.label, count: dedupe(r.people).length });
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const getConfig = async (_req, res) => {
   res.json({ emailEnabled: emailEnabled() });
};

function messageData(b) {
   const subject = typeof b.subject === 'string' ? b.subject.trim() : '';
   const body = typeof b.body === 'string' ? b.body : '';
   if (!subject) return { error: 'Subject is required' };
   if (subject.length > 200) return { error: 'Subject is too long' };
   if (!body.trim()) return { error: 'Message is required' };
   if (body.length > 20000) return { error: 'Message is too long' };
   if (!AUDIENCE_TYPES.includes(b.audienceType)) return { error: 'Choose an audience' };
   const templateId = Number(b.templateId);
   return {
      data: {
         subject,
         body,
         audienceType: b.audienceType,
         audienceRef: b.audienceRef && typeof b.audienceRef === 'object' ? b.audienceRef : {},
         templateId: Number.isInteger(templateId) && templateId > 0 ? templateId : null,
      },
   };
}

// Sends a saved message to its audience (resolved now). Updates the row.
async function deliver(db, message, { orgId, senderEmail }) {
   const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, primaryColor: true, contactEmail: true },
   });
   const audience = await resolveAudience(db, message.audienceType, message.audienceRef || {});
   if (audience.error) return { error: audience.error };
   const people = dedupe(audience.people);
   if (!people.length) return { error: 'This audience has no one with an email address' };

   await db.message.update({
      where: { id: message.id },
      data: { status: 'sending', audienceLabel: audience.label, recipientCount: people.length },
   });

   const replyTo = org.contactEmail || senderEmail || undefined;
   let sent = 0;
   let failed = 0;

   for (let i = 0; i < people.length; i += BATCH_SIZE) {
      const chunk = people.slice(i, i + BATCH_SIZE);
      const result = await sendBatch({
         people: chunk,
         subject: message.subject,
         body: message.body,
         organization: org.name,
         color: org.primaryColor || undefined,
         replyTo,
         messageId: message.id,
      });
      const now = new Date();
      // Mailgun gives one id per batch; webhooks name the recipient, so rows
      // are matched on (providerId, email).
      await db.messageRecipient.createMany({
         data: chunk.map((p) => ({
            messageId: message.id,
            userId: p.id,
            name: p.name,
            email: p.email,
            status: result.ok ? 'sent' : 'failed',
            providerId: result.id || null,
            error: result.ok ? null : result.error,
            sentAt: result.ok ? now : null,
         })),
      });
      if (result.ok) sent += chunk.length;
      else failed += chunk.length;
   }

   const status = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial';
   const updated = await db.message.update({
      where: { id: message.id },
      data: { status, sentCount: sent, failedCount: failed, sentAt: new Date() },
   });
   return { message: updated };
}

// POST /api/messages { subject, body, audienceType, audienceRef, templateId, action: 'send' | 'draft' }
// "send" with email not configured saves the message as "ready".
export const createMessage = async (req, res) => {
   const { data, error } = messageData(req.body);
   if (error) return res.status(400).json({ message: error });

   const audience = await resolveAudience(req.db, data.audienceType, data.audienceRef);
   if (audience.error) return res.status(400).json({ message: audience.error });
   const count = dedupe(audience.people).length;

   if (data.templateId) {
      const t = await req.db.messageTemplate.findFirst({ where: { id: data.templateId }, select: { id: true } });
      if (!t) data.templateId = null;
   }

   const wantsSend = req.body.action === 'send';
   if (wantsSend && count === 0) return res.status(400).json({ message: 'This audience has no one with an email address' });

   const message = await req.db.message.create({
      data: {
         ...data,
         audienceLabel: audience.label,
         recipientCount: count,
         status: wantsSend ? (emailEnabled() ? 'sending' : 'ready') : 'draft',
         createdById: req.user.id,
      },
   });

   if (!wantsSend || !emailEnabled()) return res.status(201).json({ ...message, emailEnabled: emailEnabled() });

   const result = await deliver(req.db, message, { orgId: req.orgId, senderEmail: req.user.email });
   if (result.error) {
      await req.db.message.update({ where: { id: message.id }, data: { status: 'failed' } });
      return res.status(400).json({ message: result.error });
   }
   await logSent(req, result.message);
   res.status(201).json({ ...result.message, emailEnabled: true });
};

async function logSent(req, m) {
   await logActivity(req.db, {
      type: 'message_sent',
      actorId: req.user.id,
      title: `Email sent: ${m.subject}`,
      detail: `${m.audienceLabel} · ${m.sentCount} sent${m.failedCount ? `, ${m.failedCount} failed` : ''}`,
      meta: { messageId: m.id },
   });
}

// PUT /api/messages/:id  - edit a draft or ready message
export const updateMessage = async (req, res) => {
   const id = Number(req.params.id);
   if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
   const current = await req.db.message.findFirst({ where: { id } });
   if (!current) return res.status(404).json({ message: 'Message not found' });
   if (!['draft', 'ready'].includes(current.status)) return res.status(400).json({ message: 'Sent messages cannot be edited' });

   const { data, error } = messageData(req.body);
   if (error) return res.status(400).json({ message: error });
   const audience = await resolveAudience(req.db, data.audienceType, data.audienceRef);
   if (audience.error) return res.status(400).json({ message: audience.error });

   const updated = await req.db.message.update({
      where: { id },
      data: { ...data, audienceLabel: audience.label, recipientCount: dedupe(audience.people).length },
   });
   res.json(updated);
};

// POST /api/messages/:id/send  - send a draft or ready message
export const sendMessage = async (req, res) => {
   const id = Number(req.params.id);
   if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
   const current = await req.db.message.findFirst({ where: { id } });
   if (!current) return res.status(404).json({ message: 'Message not found' });
   if (!['draft', 'ready'].includes(current.status)) return res.status(400).json({ message: 'This message was already sent' });

   if (!emailEnabled()) {
      const ready = await req.db.message.update({ where: { id }, data: { status: 'ready' } });
      return res.status(202).json({ ...ready, emailEnabled: false, message: 'Email sending is not set up yet. The message is saved and ready to send.' });
   }

   // Claim it so a double click cannot send twice.
   const { count } = await req.db.message.updateMany({ where: { id, status: current.status }, data: { status: 'sending' } });
   if (!count) return res.status(409).json({ message: 'This message is already being sent' });

   const result = await deliver(req.db, current, { orgId: req.orgId, senderEmail: req.user.email });
   if (result.error) {
      await req.db.message.update({ where: { id }, data: { status: current.status } });
      return res.status(400).json({ message: result.error });
   }
   await logSent(req, result.message);
   res.json({ ...result.message, emailEnabled: true });
};

// DELETE /api/messages/:id  - drafts and ready messages only
export const deleteMessage = async (req, res) => {
   const id = Number(req.params.id);
   if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
   const { count } = await req.db.message.deleteMany({ where: { id, status: { in: ['draft', 'ready'] } } });
   if (!count) return res.status(404).json({ message: 'Message not found or already sent' });
   res.json({ ok: true });
};

async function statsFor(db, messageIds) {
   if (!messageIds.length) return new Map();
   const [byStatus, opened, clicked] = await Promise.all([
      db.messageRecipient.groupBy({ by: ['messageId', 'status'], where: { messageId: { in: messageIds } }, _count: { _all: true } }),
      db.messageRecipient.groupBy({ by: ['messageId'], where: { messageId: { in: messageIds }, openedAt: { not: null } }, _count: { _all: true } }),
      db.messageRecipient.groupBy({ by: ['messageId'], where: { messageId: { in: messageIds }, clickedAt: { not: null } }, _count: { _all: true } }),
   ]);
   const map = new Map(messageIds.map((id) => [id, { sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 }]));
   for (const r of byStatus) {
      const s = map.get(r.messageId);
      const n = r._count._all;
      if (r.status === 'failed' || r.status === 'bounced') s.failed += n;
      else {
         s.sent += n;
         if (r.status === 'delivered') s.delivered += n;
      }
   }
   for (const r of opened) map.get(r.messageId).opened = r._count._all;
   for (const r of clicked) map.get(r.messageId).clicked = r._count._all;
   // An opened email was delivered even if the delivered event came late.
   for (const s of map.values()) s.delivered = Math.max(s.delivered, s.opened);
   return map;
}

// GET /api/messages
export const listMessages = async (req, res) => {
   const messages = await req.db.message.findMany({
      orderBy: { id: 'desc' },
      take: 200,
      include: { template: { select: { id: true, name: true } } },
   });
   const stats = await statsFor(req.db, messages.map((m) => m.id));
   res.json(messages.map((m) => ({ ...m, stats: stats.get(m.id) })));
};

// GET /api/messages/:id
export const getMessage = async (req, res) => {
   const id = Number(req.params.id);
   if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
   const message = await req.db.message.findFirst({
      where: { id },
      include: {
         template: { select: { id: true, name: true } },
         recipients: { orderBy: { id: 'asc' }, take: 2000 },
      },
   });
   if (!message) return res.status(404).json({ message: 'Message not found' });
   const stats = await statsFor(req.db, [id]);
   res.json({ ...message, stats: stats.get(id) });
};

// ---------------------------------------------------------------------------
// Mailgun webhook (delivered, opened, clicked, permanent failures, spam
// complaints). Not tenant-scoped: rows are found by Mailgun's message id plus
// the recipient's address.
// POST /api/messages/webhook/mailgun   (raw body, JSON)
// ---------------------------------------------------------------------------
export const mailgunWebhook = async (req, res) => {
   const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
   let payload;
   try { payload = JSON.parse(raw); } catch { return res.status(400).json({ message: 'Invalid JSON' }); }
   if (!verifyMailgunSignature(payload?.signature)) return res.status(406).json({ message: 'Invalid signature' });

   const ev = payload['event-data'] || {};
   const providerId = normalizeMessageId(ev.message?.headers?.['message-id']);
   const email = String(ev.recipient || '').toLowerCase();
   if (!providerId || !email) return res.json({ ok: true });

   const at = ev.timestamp ? new Date(Number(ev.timestamp) * 1000) : new Date();
   const data = {};
   switch (ev.event) {
      case 'delivered': data.status = 'delivered'; data.deliveredAt = at; break;
      case 'opened': data.openedAt = at; break;
      case 'clicked': data.clickedAt = at; break;
      case 'failed':
         if (ev.severity !== 'permanent') return res.json({ ok: true }); // Mailgun keeps retrying temporary failures
         data.status = 'bounced';
         data.error = String(ev['delivery-status']?.description || ev['delivery-status']?.message || ev.reason || 'Bounced').slice(0, 300);
         break;
      case 'complained': data.status = 'bounced'; data.error = 'Marked as spam'; break;
      default: return res.json({ ok: true });
   }
   const where = { providerId, email: { equals: email, mode: 'insensitive' } };
   // Keep the first open and click time.
   if (data.openedAt) where.openedAt = null;
   if (data.clickedAt) where.clickedAt = null;
   // A late "delivered" must not undo a bounce.
   if (data.status === 'delivered') where.status = { notIn: ['bounced'] };
   await prisma.messageRecipient.updateMany({ where, data });
   res.json({ ok: true });
};
