// Public sign-up, invite acceptance and first-run setup.
import bcrypt from 'bcryptjs';
import slugify from 'slugify';
import { prisma } from '../config/db.js';
import { hashToken, signAccessToken, createRefreshTokenString, REFRESH_EXPIRES_SECONDS } from '../utils/tokens.js';
import { inviteStatus } from '../utils/invites.js';
import { orgPublic } from '../utils/selects.js';
import { ROLES } from '../middleware/auth.js';

export const ORG_STATUS = { SUSPENDED: 0, ACTIVE: 1, PENDING: 2, REJECTED: 3 };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// POST /api/onboarding/signup  (public)
// An organization applies; it stays "pending" until a platform admin approves it.
export const signup = async (req, res) => {
   // Honeypot: real users never fill the hidden "website" field.
   if (str(req.body.website)) return res.status(201).json({ ok: true });

   const name = str(req.body.organizationName, 120);
   const contactName = str(req.body.contactName, 120);
   const contactEmail = str(req.body.contactEmail, 200).toLowerCase();
   const contactPhone = str(req.body.contactPhone, 40);
   const tagline = str(req.body.tagline, 200) || null;

   if (!name || !contactName || !contactEmail || !contactPhone) {
      return res.status(400).json({ message: 'Organization name, your name, email and phone are required' });
   }
   if (!EMAIL.test(contactEmail)) return res.status(400).json({ message: 'Enter a valid email address' });

   const emailTaken = await prisma.user.findUnique({ where: { email: contactEmail }, select: { id: true } });
   if (emailTaken) {
      return res.status(400).json({ message: 'That email already has an account. Log in instead, or use a different email.' });
   }
   const pendingDup = await prisma.organization.findFirst({
      where: { contactEmail, status: ORG_STATUS.PENDING },
      select: { id: true },
   });
   if (pendingDup) {
      return res.status(400).json({ message: 'An application with this email is already waiting for review.' });
   }

   // Unique slug: "houston-chamber", then "houston-chamber-2", ...
   const base = slugify(name, { lower: true, strict: true }).slice(0, 60) || 'organization';
   let slug = base;
   for (let i = 2; await prisma.organization.findUnique({ where: { slug }, select: { id: true } }); i++) {
      slug = `${base}-${i}`;
   }

   await prisma.organization.create({
      data: { name, slug, tagline, contactName, contactEmail, contactPhone, status: ORG_STATUS.PENDING },
   });
   res.status(201).json({ ok: true });
};

async function loadInvite(token) {
   if (!token || typeof token !== 'string' || token.length > 200) return null;
   return prisma.invite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { organization: { select: { ...orgPublic, status: true, contactPhone: true } } },
   });
}

const INVITE_PROBLEM = {
   used: [410, 'This invite link has already been used. Log in instead.'],
   revoked: [410, 'This invite link was replaced by a newer one. Ask for the latest link.'],
   expired: [410, 'This invite link has expired. Ask for a new one.'],
};

// GET /api/onboarding/invites/:token  (public)
export const getInvite = async (req, res) => {
   const inv = await loadInvite(req.params.token);
   if (!inv) return res.status(404).json({ message: 'This invite link is not valid.' });
   const status = inviteStatus(inv);
   if (INVITE_PROBLEM[status]) {
      const [code, message] = INVITE_PROBLEM[status];
      return res.status(code).json({ message, status });
   }
   if (inv.organization.status !== ORG_STATUS.ACTIVE) {
      return res.status(410).json({ message: 'This organization is not active.', status: 'inactive' });
   }
   const { status: _s, contactPhone, ...organization } = inv.organization;
   res.json({
      email: inv.email,
      name: inv.name,
      phone: contactPhone || '',
      expiresAt: inv.expiresAt,
      organization,
   });
};

// POST /api/onboarding/invites/:token/accept  (public)
// Creates the admin account, burns the invite, and logs the person in.
export const acceptInvite = async (req, res) => {
   const name = str(req.body.name, 120);
   const phone = str(req.body.phone, 40);
   const password = typeof req.body.password === 'string' ? req.body.password : '';
   if (!name || !phone) return res.status(400).json({ message: 'Your name and phone are required' });
   if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });

   const inv = await loadInvite(req.params.token);
   if (!inv) return res.status(404).json({ message: 'This invite link is not valid.' });
   const status = inviteStatus(inv);
   if (INVITE_PROBLEM[status]) {
      const [code, message] = INVITE_PROBLEM[status];
      return res.status(code).json({ message, status });
   }
   if (inv.organization.status !== ORG_STATUS.ACTIVE) {
      return res.status(410).json({ message: 'This organization is not active.' });
   }
   if (await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } })) {
      return res.status(400).json({ message: 'An account with this email already exists. Log in instead.' });
   }

   const hashed = await bcrypt.hash(password, 10);
   const refresh = createRefreshTokenString();

   const user = await prisma.$transaction(async (tx) => {
      // Burn the invite first; the conditional update makes double-submits safe.
      const burned = await tx.invite.updateMany({
         where: { id: inv.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
         data: { usedAt: new Date() },
      });
      if (burned.count !== 1) {
         const err = new Error('This invite link has already been used.');
         err.status = 410;
         throw err;
      }
      const u = await tx.user.create({
         data: {
            organizationId: inv.organizationId,
            name,
            email: inv.email,
            phone,
            password: hashed,
            role: inv.role || ROLES.ADMIN,
         },
      });
      await tx.refreshToken.create({
         data: {
            tokenHash: hashToken(refresh),
            userId: u.id,
            expiresAt: new Date(Date.now() + REFRESH_EXPIRES_SECONDS * 1000),
         },
      });
      return u;
   });

   const { status: _s, contactPhone: _p, ...organization } = inv.organization;
   res.status(201).json({
      accessToken: signAccessToken(user),
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

// POST /api/organizations/current/onboarding-complete  (org admin)
export const completeOnboarding = async (req, res) => {
   const org = await prisma.organization.update({
      where: { id: req.orgId },
      data: { onboardedAt: new Date() },
      select: orgPublic,
   });
   res.json(org);
};
