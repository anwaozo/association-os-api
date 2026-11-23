import crypto from 'node:crypto';
import { env } from '../config/env.js';

// Email goes out through Mailgun (US region by default). Until
// MAILGUN_API_KEY, MAILGUN_DOMAIN and EMAIL_FROM are set, messages are saved
// as "ready" and nothing is sent.
export const emailEnabled = () => Boolean(env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN && env.EMAIL_FROM);

// Mailgun accepts up to 1,000 recipients per batch call. Each recipient gets
// their own copy (recipient-variables), so nobody sees anyone else's address.
export const BATCH_SIZE = 1000;

const escapeHtml = (s) =>
   String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const firstName = (name) => (name || '').trim().split(/\s+/)[0] || 'there';

// {{first_name}} {{name}} {{email}} {{organization}} for one person (preview, tests).
export function mergeFields(text, { name, email, organization }) {
   return String(text)
      .replace(/\{\{\s*first_name\s*\}\}/gi, firstName(name))
      .replace(/\{\{\s*name\s*\}\}/gi, name || firstName(name))
      .replace(/\{\{\s*email\s*\}\}/gi, email || '')
      .replace(/\{\{\s*organization\s*\}\}/gi, organization || '');
}

// Turns our merge fields into Mailgun's per-recipient placeholders. The
// organization name is the same for everyone, so it is filled in directly.
// `html` picks the HTML-escaped copies of each value.
function toMailgunPlaceholders(text, organization, html = false) {
   const v = (k) => `%recipient.${k}${html ? '_h' : ''}%`;
   return String(text)
      .replace(/\{\{\s*first_name\s*\}\}/gi, v('first_name'))
      .replace(/\{\{\s*name\s*\}\}/gi, v('name'))
      .replace(/\{\{\s*email\s*\}\}/gi, v('email'))
      .replace(/\{\{\s*organization\s*\}\}/gi, html ? escapeHtml(organization) : organization);
}

// Plain-text body -> simple branded HTML. Links become clickable.
// Mailgun placeholders (%recipient.x%) pass through untouched.
export function renderHtml(body, { organization, color = '#1F3864' }) {
   const paragraphs = escapeHtml(body)
      .split(/\n{2,}/)
      .map((p) => p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:' + color + '">$1</a>'))
      .map((p) => `<p style="margin:0 0 16px;line-height:1.6">${p}</p>`)
      .join('');
   return `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<div style="max-width:600px;margin:0 auto;padding:24px">
<div style="background:${color};color:#fff;padding:16px 24px;border-radius:8px 8px 0 0;font-weight:bold;font-size:18px">${escapeHtml(organization)}</div>
<div style="background:#fff;padding:24px;border-radius:0 0 8px 8px">${paragraphs}</div>
<p style="font-size:12px;color:#6b7280;text-align:center;margin-top:16px">Sent by ${escapeHtml(organization)} via AssociationOS</p>
</div></body></html>`;
}

// Mailgun returns "<id@domain>"; webhooks report it without the brackets.
export const normalizeMessageId = (id) => String(id || '').trim().replace(/^<|>$/g, '');

// Sends one batch (<= 1,000 people) as a single Mailgun call.
// people: [{ name, email }]. Returns { ok, id?, error? } for the whole batch.
export async function sendBatch({ people, subject, body, organization, color, replyTo, messageId }) {
   const vars = {};
   for (const p of people) {
      const f = firstName(p.name);
      const n = p.name || f;
      vars[p.email] = {
         first_name: f, name: n, email: p.email,
         first_name_h: escapeHtml(f), name_h: escapeHtml(n), email_h: escapeHtml(p.email),
      };
   }

   const form = new URLSearchParams();
   form.append('from', `${organization} <${env.EMAIL_FROM}>`);
   for (const p of people) form.append('to', p.email);
   form.append('subject', toMailgunPlaceholders(subject, organization));
   form.append('text', toMailgunPlaceholders(body, organization));
   form.append('html', renderHtml(toMailgunPlaceholders(body, organization, true), { organization, color }));
   form.append('recipient-variables', JSON.stringify(vars));
   form.append('o:tracking', 'yes');
   form.append('o:tracking-opens', 'yes');
   form.append('o:tracking-clicks', 'htmlonly');
   if (replyTo) form.append('h:Reply-To', replyTo);
   if (messageId) form.append('v:aos_message_id', String(messageId));

   const base = env.MAILGUN_API_BASE.replace(/\/$/, '');
   try {
      const res = await fetch(`${base}/v3/${encodeURIComponent(env.MAILGUN_DOMAIN)}/messages`, {
         method: 'POST',
         headers: {
            Authorization: `Basic ${Buffer.from(`api:${env.MAILGUN_API_KEY}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
         },
         body: form.toString(),
      });
      // Mailgun answers some errors (e.g. 401 Forbidden) in plain text, not JSON.
      const raw = await res.text().catch(() => '');
      let json = {};
      try { json = raw ? JSON.parse(raw) : {}; } catch { json = {}; }
      if (!res.ok) {
         const detail = String(json?.message || raw || '').trim();
         const hint = res.status === 401 ? ' (check MAILGUN_API_KEY and that the key belongs to this domain and region)' : '';
         return { ok: false, error: `Mailgun error ${res.status}${detail ? `: ${detail}` : ''}${hint}`.slice(0, 300) };
      }
      return json?.id ? { ok: true, id: normalizeMessageId(json.id) } : { ok: false, error: 'Mailgun returned no message id' };
   } catch (err) {
      return { ok: false, error: String(err?.message || err).slice(0, 300) };
   }
}

// Mailgun signs each webhook: HMAC-SHA256 (hex) of timestamp + token, keyed
// with the domain's HTTP webhook signing key.
export function verifyMailgunSignature(signature, key = env.MAILGUN_WEBHOOK_SIGNING_KEY) {
   if (!key || !signature) return false;
   const { timestamp, token, signature: sig } = signature;
   if (!timestamp || !token || !sig) return false;
   // Mailgun retries for up to 8 hours with the original signature.
   if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 24 * 3600) return false;
   const expected = crypto.createHmac('sha256', key).update(`${timestamp}${token}`).digest('hex');
   const a = Buffer.from(String(sig));
   const b = Buffer.from(expected);
   return a.length === b.length && crypto.timingSafeEqual(a, b);
}
