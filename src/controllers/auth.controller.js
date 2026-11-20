// src/controllers/auth.controller.js
import bcrypt from 'bcryptjs';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import {
   signAccessToken,
   createRefreshTokenString,
   hashToken,
   REFRESH_EXPIRES_SECONDS,
} from '../utils/tokens.js';
import { userPublic, orgPublic } from '../utils/selects.js';
import { ROLES } from '../middleware/auth.js';
import { logActivity } from '../utils/activity.js';

const REFRESH_COOKIE_NAME = 'jid';
const cookieOptions = {
   httpOnly: true,
   secure: env.isProd,
   // Frontend and API may live on different domains (Netlify), so the cookie
   // must be cross-site in production. The body token is the fallback.
   sameSite: env.isProd ? 'none' : 'lax',
   path: '/api/auth',
   maxAge: REFRESH_EXPIRES_SECONDS * 1000,
};

export const BULK_IMPORT_MAX = Number(process.env.BULK_IMPORT_MAX || 250);

const ALLOWED_ROLES = [ROLES.ADMIN, ROLES.MEMBER, ROLES.CONTACT];

const parseRole = (role, fallback = ROLES.CONTACT) => {
   if (role === undefined || role === null || role === '') return fallback;
   const r = Number(role);
   return ALLOWED_ROLES.includes(r) ? r : null;
};

const clean = (v) => (typeof v === 'string' ? v.trim() : v);

async function issueRefreshToken(userId) {
   const refresh = createRefreshTokenString();
   const created = await prisma.refreshToken.create({
      data: {
         tokenHash: hashToken(refresh),
         userId,
         expiresAt: new Date(Date.now() + REFRESH_EXPIRES_SECONDS * 1000),
      },
   });
   return { refresh, record: created };
}

// ---------------------------------------------------------------------------
// Admin-only: add / edit / import people in the caller's organization.
// (Kept at /api/auth/* so the existing frontend keeps working.)
// ---------------------------------------------------------------------------

export const register = async (req, res) => {
   const name = clean(req.body.name);
   const email = clean(req.body.email)?.toLowerCase();
   const phone = clean(req.body.phone);
   const { password } = req.body;
   const role = parseRole(req.body.role);

   if (!email || !phone) return res.status(400).json({ message: 'Email and phone are required' });
   if (role === null) return res.status(400).json({ message: 'Invalid role' });

   // Email is unique platform-wide, so check it unscoped.
   const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
   if (exists) return res.status(400).json({ message: 'Email already in use' });

   const phoneExists = await req.db.user.findFirst({ where: { phone }, select: { id: true } });
   if (phoneExists) return res.status(400).json({ message: 'Phone already in use' });

   // TODO(post-demo): replace phone-as-default-password with an invite email.
   const hashed = await bcrypt.hash(password || phone, 10);

   const user = await req.db.user.create({
      data: { name, email, phone, password: hashed, role },
      select: userPublic,
   });

   await logActivity(req.db, {
      type: 'member_joined',
      actorId: req.user.id,
      title: `${user.name || user.email} was added as a ${role === ROLES.MEMBER ? 'member' : role === ROLES.ADMIN ? 'admin' : 'contact'}`,
      detail: user.email,
      meta: { userId: user.id, role },
   });

   res.status(201).json(user);
};

export const update = async (req, res) => {
   const id = Number(req.params.id);
   if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });

   const data = {};
   if (req.body.name !== undefined) data.name = clean(req.body.name);
   if (req.body.email !== undefined) data.email = clean(req.body.email)?.toLowerCase();
   if (req.body.phone !== undefined) data.phone = clean(req.body.phone);
   if (req.body.status !== undefined) data.status = Number(req.body.status);
   if (req.body.role !== undefined && req.body.role !== null && req.body.role !== '') {
      const role = parseRole(req.body.role);
      if (role === null) return res.status(400).json({ message: 'Invalid role' });
      data.role = role;
   }
   if (req.body.password) data.password = await bcrypt.hash(req.body.password, 10);

   // Scoped update: an id from another organization returns 404.
   const updated = await req.db.user.update({ where: { id }, data, select: userPublic });
   res.status(200).json(updated);
};

export const bulk_register = async (req, res) => {
   const { users } = req.body;

   if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ message: 'Invalid users array' });
   }
   // Serverless functions have short time limits; the frontend sends large
   // files in chunks of this size.
   if (users.length > BULK_IMPORT_MAX) {
      return res.status(400).json({ message: `Import at most ${BULK_IMPORT_MAX} people at a time` });
   }

   const rows = [];
   for (const u of users) {
      const email = clean(u.email)?.toLowerCase();
      const phone = clean(u.phone) ? String(clean(u.phone)) : '';
      const role = parseRole(u.role);
      if (!email || !phone || role === null) continue;
      rows.push({ name: clean(u.name), email, phone, role });
   }

   // Lower bcrypt cost for bulk import keeps serverless requests short.
   const formatted = await Promise.all(
      rows.map(async (r) => ({ ...r, password: await bcrypt.hash(r.phone, 8) })),
   );

   const created = await req.db.user.createMany({ data: formatted, skipDuplicates: true });

   if (created.count > 0) {
      await logActivity(req.db, {
         type: 'members_imported',
         actorId: req.user.id,
         title: `${created.count} ${created.count === 1 ? 'person was' : 'people were'} imported`,
         meta: { count: created.count },
      });
   }

   res.status(200).json({
      message: `${created.count} people imported successfully`,
      count: created.count,
      skipped: users.length - created.count,
   });
};

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export const login = async (req, res) => {
   const email = clean(req.body.email)?.toLowerCase();
   const { password } = req.body;
   if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

   const user = await prisma.user.findUnique({
      where: { email },
      include: { organization: { select: { ...orgPublic, status: true } } },
   });

   // Same message for unknown email and wrong password (no account probing).
   const valid = user ? await bcrypt.compare(password, user.password) : false;
   if (!user || !valid) return res.status(401).json({ message: 'Incorrect email or password' });

   if (user.status === 0) return res.status(403).json({ message: 'This account is disabled' });
   if (user.organization?.status !== 1) {
      return res.status(403).json({ message: 'This organization is not active' });
   }

   const accessToken = signAccessToken(user);
   const { refresh } = await issueRefreshToken(user.id);

   res.cookie(REFRESH_COOKIE_NAME, refresh, cookieOptions);

   const { status: _s, ...organization } = user.organization;
   return res.json({
      accessToken,
      refreshToken: refresh,
      user: {
         id: user.id,
         email: user.email,
         name: user.name,
         role: user.role,
         organizationId: user.organizationId,
         isPlatformAdmin: user.isPlatformAdmin,
      },
      organization,
   });
};

export const refresh = async (req, res) => {
   const incoming = req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE_NAME];
   if (!incoming) return res.status(401).json({ message: 'No refresh token' });

   const tokenRecord = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(incoming) } });
   if (!tokenRecord) return res.status(401).json({ message: 'Invalid refresh token' });

   if (tokenRecord.revoked) {
      // Reuse of a rotated token: assume theft and revoke every session for this user.
      await prisma.refreshToken.updateMany({ where: { userId: tokenRecord.userId }, data: { revoked: true } });
      return res.status(401).json({ message: 'Refresh token revoked. Please log in again.' });
   }

   if (new Date() > tokenRecord.expiresAt) {
      await prisma.refreshToken.update({ where: { id: tokenRecord.id }, data: { revoked: true } });
      return res.status(401).json({ message: 'Refresh token expired' });
   }

   const user = await prisma.user.findUnique({
      where: { id: tokenRecord.userId },
      include: { organization: { select: { status: true } } },
   });
   if (!user || user.status === 0 || user.organization?.status !== 1) {
      return res.status(401).json({ message: 'Please log in again' });
   }

   // Rotate
   const { refresh: newRefresh, record } = await issueRefreshToken(user.id);
   await prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revoked: true, replacedBy: record.id },
   });

   res.cookie(REFRESH_COOKIE_NAME, newRefresh, cookieOptions);
   return res.json({ accessToken: signAccessToken(user), refreshToken: newRefresh });
};

export const logout = async (req, res) => {
   const incoming = req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE_NAME];
   if (incoming) {
      await prisma.refreshToken.updateMany({
         where: { tokenHash: hashToken(incoming) },
         data: { revoked: true },
      });
   }
   res.clearCookie(REFRESH_COOKIE_NAME, { path: cookieOptions.path });
   return res.json({ message: 'Logged out' });
};
