import crypto from 'node:crypto';
import { env } from '../config/env.js';

// Email goes out through Resend (https://resend.com). Until RESEND_API_KEY
// and EMAIL_FROM are set, messages are saved as "ready" and nothing is sent.
export const emailEnabled = () => Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);

const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
export const BATCH_SIZE = 100; // Resend's batch limit

const escapeHtml = (s) =>
   String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// {{first_name}} {{name}} {{email}} {{organization}}
export function mergeFields(text, { name, email, organization }) {
   const first = (name || '').trim().split(/\s+/)[0] || 'there';
   return String(text)
      .replace(/\{\{\s*first_name\s*\}\}/gi, first)
      .replace(/\{\{\s*name\s*\}\}/gi, name || first)
      .replace(/\{\{\s*email\s*\}\}/gi, email || '')
      .replace(/\{\{\s*organization\s*\}\}/gi, organization || '');
}

// Plain-text body -> simple branded HTML. Links become clickable.
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

// Sends one batch (<= 100). Returns [{ ok, id?, error? }] in input order.
export async function sendBatch(emails) {
   try {
      const res = await fetch(RESEND_BATCH_URL, {
         method: 'POST',
         headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
         body: JSON.stringify(emails),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
         const error = String(json?.message || json?.error || `Resend error ${res.status}`).slice(0, 300);
         return emails.map(() => ({ ok: false, error }));
      }
      const ids = Array.isArray(json?.data) ? json.data : [];
      return emails.map((_, i) => (ids[i]?.id ? { ok: true, id: ids[i].id } : { ok: false, error: 'No id returned' }));
   } catch (err) {
      return emails.map(() => ({ ok: false, error: String(err?.message || err).slice(0, 300) }));
   }
}

// Resend signs webhooks with Svix: HMAC-SHA256 over "id.timestamp.body",
// keyed with the base64 part of the "whsec_..." secret.
export function verifyResendSignature(rawBody, headers, secret = env.RESEND_WEBHOOK_SECRET) {
   if (!secret) return false;
   const id = headers['svix-id'];
   const ts = headers['svix-timestamp'];
   const sigHeader = headers['svix-signature'];
   if (!id || !ts || !sigHeader) return false;
   if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
   const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
   const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest();
   return String(sigHeader)
      .split(' ')
      .map((part) => part.split(',')[1])
      .filter(Boolean)
      .some((sig) => {
         const given = Buffer.from(sig, 'base64');
         return given.length === expected.length && crypto.timingSafeEqual(given, expected);
      });
}
