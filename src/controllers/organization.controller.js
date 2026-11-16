import bcrypt from 'bcryptjs';
import slugify from 'slugify';
import { prisma } from '../config/db.js';
import { orgPublic } from '../utils/selects.js';
import { ROLES } from '../middleware/auth.js';

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

export const listOrganizations = async (_req, res) => {
   const orgs = await prisma.organization.findMany({
      orderBy: { id: 'asc' },
      select: {
         ...orgPublic,
         status: true,
         createdAt: true,
         _count: { select: { users: true, events: true, memberships: true, campaigns: true } },
      },
   });
   res.json(orgs);
};

// Creates an organization and its first admin in one transaction.
export const createOrganization = async (req, res) => {
   const { admin = {} } = req.body;
   const { data, error } = brandingData(req.body);
   if (error) return res.status(400).json({ message: error });
   if (!data.name) return res.status(400).json({ message: 'Organization name is required' });

   const slug = slugify(req.body.slug || data.name, { lower: true, strict: true });
   if (!slug) return res.status(400).json({ message: 'Invalid slug' });

   const email = admin.email ? String(admin.email).trim().toLowerCase() : '';
   const phone = admin.phone ? String(admin.phone).trim() : '';
   if (!email || !phone || !admin.password || String(admin.password).length < 8) {
      return res.status(400).json({ message: 'Admin email, phone and a password of at least 8 characters are required' });
   }

   const [slugTaken, emailTaken] = await Promise.all([
      prisma.organization.findUnique({ where: { slug }, select: { id: true } }),
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
   ]);
   if (slugTaken) return res.status(400).json({ message: 'That organization slug is taken' });
   if (emailTaken) return res.status(400).json({ message: 'Admin email already in use' });

   const password = await bcrypt.hash(String(admin.password), 10);

   const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { ...data, slug }, select: orgPublic });
      const user = await tx.user.create({
         data: {
            organizationId: org.id,
            name: admin.name ? String(admin.name).trim() : null,
            email,
            phone,
            password,
            role: ROLES.ADMIN,
         },
         select: { id: true, name: true, email: true, role: true },
      });
      return { organization: org, admin: user };
   });

   res.status(201).json(result);
};

export const setOrganizationStatus = async (req, res) => {
   const id = Number(req.params.id);
   const status = Number(req.body.status);
   if (!Number.isInteger(id) || ![0, 1].includes(status)) {
      return res.status(400).json({ message: 'Invalid request' });
   }
   const org = await prisma.organization.update({
      where: { id },
      data: { status },
      select: { ...orgPublic, status: true },
   });
   res.json(org);
};
