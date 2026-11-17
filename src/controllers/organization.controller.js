import slugify from 'slugify';
import { prisma } from '../config/db.js';
import { orgPublic } from '../utils/selects.js';
import { issueInvite, publicInvite } from '../utils/invites.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

function brandingData(body) {
   const data = {};
   if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return { error: 'Name cannot be empty' };
      data.name = name;
   }
   if (body.tagline !== undefined) data.tagline = body.tagline ? String(body.tagline).trim() : null;
   if (body.logoUrl !== undefined) {
      const url = body.logoUrl ? String(body.logoUrl).trim() : null;
      if (url && !/^https:\/\//.test(url) && !url.startsWith('/')) {
         return { error: 'Logo URL must start with https://' };
      }
      data.logoUrl = url;
   }
   if (body.primaryColor !== undefined) {
      if (body.primaryColor && !HEX.test(body.primaryColor)) return { error: 'Color must look like #1F3864' };
      data.primaryColor = body.primaryColor || null;
   }
   return { data };
}

// --- Tenant-facing --------------------------------------------------------

// Branding for the logged-in user's organization.
export const getCurrent = async (req, res) => {
   const org = await prisma.organization.findUnique({ where: { id: req.orgId }, select: orgPublic });
   if (!org) return res.status(404).json({ message: 'Organization not found' });
   res.json(org);
};

// Org admins can change their own name, tagline, logo and color.
export const updateCurrent = async (req, res) => {
   const { data, error } = brandingData(req.body);
   if (error) return res.status(400).json({ message: error });
   const org = await prisma.organization.update({ where: { id: req.orgId }, data, select: orgPublic });
   res.json(org);
};

// Public branding by slug, for a per-organization login page (no auth).
export const getPublicBySlug = async (req, res) => {
   const org = await prisma.organization.findFirst({
      where: { slug: String(req.params.slug).toLowerCase(), status: 1 },
      select: { name: true, slug: true, tagline: true, logoUrl: true, primaryColor: true },
   });
   if (!org) return res.status(404).json({ message: 'Organization not found' });
   res.json(org);
};

// --- Platform (Apperr staff) ------------------------------------------------

const ORG_STATUS = { SUSPENDED: 0, ACTIVE: 1, PENDING: 2, REJECTED: 3 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const platformOrgSelect = {
   ...orgPublic,
   status: true,
   contactName: true,
   contactEmail: true,
   contactPhone: true,
   approvedAt: true,
   rejectedAt: true,
   rejectionReason: true,
   createdAt: true,
   _count: { select: { users: true, events: true, memberships: true, campaigns: true } },
   invites: { orderBy: { createdAt: 'desc' }, take: 1 },
};

const shapeOrg = ({ invites, ...org }) => ({
   ...org,
   latestInvite: invites?.[0] ? publicInvite(invites[0]) : null,
});

const inviteResponse = (token, invite) => ({ token, ...publicInvite(invite) });

export const listOrganizations = async (req, res) => {
   const where = {};
   if (req.query.status !== undefined && req.query.status !== '') where.status = Number(req.query.status);
   const orgs = await prisma.organization.findMany({
      where,
      orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
      select: platformOrgSelect,
   });
   res.json(orgs.map(shapeOrg));
};

// Creates an approved organization and an invite link for its first admin.
export const createOrganization = async (req, res) => {
   const { data, error } = brandingData(req.body);
   if (error) return res.status(400).json({ message: error });
   if (!data.name) return res.status(400).json({ message: 'Organization name is required' });

   const contactName = req.body.contactName ? String(req.body.contactName).trim() : null;
   const contactEmail = req.body.contactEmail ? String(req.body.contactEmail).trim().toLowerCase() : '';
   const contactPhone = req.body.contactPhone ? String(req.body.contactPhone).trim() : null;
   if (!EMAIL.test(contactEmail)) return res.status(400).json({ message: "Enter the admin's email address" });

   const slug = slugify(req.body.slug || data.name, { lower: true, strict: true });
   if (!slug) return res.status(400).json({ message: 'Invalid slug' });

   const [slugTaken, emailTaken] = await Promise.all([
      prisma.organization.findUnique({ where: { slug }, select: { id: true } }),
      prisma.user.findUnique({ where: { email: contactEmail }, select: { id: true } }),
   ]);
   if (slugTaken) return res.status(400).json({ message: 'That web address is already taken' });
   if (emailTaken) return res.status(400).json({ message: 'That email already has an account' });

   const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
         data: { ...data, slug, contactName, contactEmail, contactPhone, status: ORG_STATUS.ACTIVE, approvedAt: new Date() },
      });
      const { token, invite } = await issueInvite(tx, {
         organizationId: org.id, email: contactEmail, name: contactName, createdById: req.user.id,
      });
      const full = await tx.organization.findUnique({ where: { id: org.id }, select: platformOrgSelect });
      return { organization: shapeOrg(full), invite: inviteResponse(token, invite) };
   });

   res.status(201).json(result);
};

export const approveOrganization = async (req, res) => {
   const id = Number(req.params.id);
   const org = await prisma.organization.findUnique({ where: { id }, select: { id: true, status: true, contactEmail: true, contactName: true } });
   if (!org) return res.status(404).json({ message: 'Organization not found' });
   if (org.status !== ORG_STATUS.PENDING) return res.status(400).json({ message: 'Only pending applications can be approved' });
   if (!org.contactEmail) return res.status(400).json({ message: 'This application has no contact email' });
   if (await prisma.user.findUnique({ where: { email: org.contactEmail }, select: { id: true } })) {
      return res.status(400).json({ message: 'The contact email already has an account' });
   }

   const result = await prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id }, data: { status: ORG_STATUS.ACTIVE, approvedAt: new Date(), rejectedAt: null, rejectionReason: null } });
      const { token, invite } = await issueInvite(tx, {
         organizationId: id, email: org.contactEmail, name: org.contactName, createdById: req.user.id,
      });
      const full = await tx.organization.findUnique({ where: { id }, select: platformOrgSelect });
      return { organization: shapeOrg(full), invite: inviteResponse(token, invite) };
   });
   res.json(result);
};

export const rejectOrganization = async (req, res) => {
   const id = Number(req.params.id);
   const org = await prisma.organization.findUnique({ where: { id }, select: { status: true } });
   if (!org) return res.status(404).json({ message: 'Organization not found' });
   if (org.status !== ORG_STATUS.PENDING) return res.status(400).json({ message: 'Only pending applications can be rejected' });
   const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 500) : null;
   const updated = await prisma.organization.update({
      where: { id },
      data: { status: ORG_STATUS.REJECTED, rejectedAt: new Date(), rejectionReason: reason },
      select: platformOrgSelect,
   });
   res.json({ organization: shapeOrg(updated) });
};

// New invite link for an approved org whose admin hasn't signed up yet.
// Any older open link stops working immediately.
export const regenerateInvite = async (req, res) => {
   const id = Number(req.params.id);
   const org = await prisma.organization.findUnique({ where: { id }, select: { status: true, contactEmail: true, contactName: true } });
   if (!org) return res.status(404).json({ message: 'Organization not found' });
   if (org.status !== ORG_STATUS.ACTIVE) return res.status(400).json({ message: 'Approve the organization first' });
   const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : org.contactEmail;
   if (!email || !EMAIL.test(email)) return res.status(400).json({ message: 'A valid admin email is required' });
   if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      return res.status(400).json({ message: 'That email already has an account. They can log in.' });
   }

   const result = await prisma.$transaction(async (tx) => {
      if (email !== org.contactEmail) await tx.organization.update({ where: { id }, data: { contactEmail: email } });
      const { token, invite } = await issueInvite(tx, { organizationId: id, email, name: org.contactName, createdById: req.user.id });
      const full = await tx.organization.findUnique({ where: { id }, select: platformOrgSelect });
      return { organization: shapeOrg(full), invite: inviteResponse(token, invite) };
   });
   res.json(result);
};

export const setOrganizationStatus = async (req, res) => {
   const id = Number(req.params.id);
   const status = Number(req.body.status);
   if (!Number.isInteger(id) || ![ORG_STATUS.SUSPENDED, ORG_STATUS.ACTIVE].includes(status)) {
      return res.status(400).json({ message: 'Invalid request' });
   }
   const current = await prisma.organization.findUnique({ where: { id }, select: { status: true } });
   if (!current) return res.status(404).json({ message: 'Organization not found' });
   if (![ORG_STATUS.SUSPENDED, ORG_STATUS.ACTIVE].includes(current.status)) {
      return res.status(400).json({ message: 'Approve or reject this application instead' });
   }
   const org = await prisma.organization.update({ where: { id }, data: { status }, select: platformOrgSelect });
   res.json({ organization: shapeOrg(org) });
};
