import bcrypt from 'bcryptjs';
import { addMonths, addYears } from 'date-fns';
import { orgPublic, userPublic } from '../utils/selects.js';

export const me = async (req, res) => {
   const user = await req.db.user.findFirst({
      where: { id: req.user.id },
      select: { ...userPublic, isPlatformAdmin: true, organization: { select: orgPublic } },
   });
   if (!user) return res.status(404).json({ message: 'User not found' });
   res.json(user);
};

export const userDashboard = async (req, res) => {
   const [user, membershipHistory, memberships] = await Promise.all([
      req.db.user.findFirst({
         where: { id: req.user.id },
         select: {
            id: true,
            name: true,
            email: true,
            membership: { select: { id: true, name: true } },
            rsvps: { include: { event: true } },
         },
      }),
      req.db.userMembershipHistory.findFirst({
         where: { userId: req.user.id },
         orderBy: { createdAt: 'desc' },
         include: { membership: true },
      }),
      req.db.membership.findMany({ orderBy: { price: 'asc' } }),
   ]);

   if (!user) return res.status(404).json({ message: 'User not found' });
   return res.json({ ...user, membershipHistory, memberships });
};

export const updateMembership = async (req, res) => {
   const membershipId = Number(req.body.membershipId);
   if (!Number.isInteger(membershipId)) {
      return res.status(400).json({ message: 'membershipId is required' });
   }

   // The tier must belong to the caller's organization.
   const membership = await req.db.membership.findFirst({
      where: { id: membershipId },
      select: { id: true, billing_cadence: true },
   });
   if (!membership) return res.status(404).json({ message: 'Membership not found' });

   const startDate = new Date();
   let endDate = null;
   // Tiers created in the app store "Monthly"/"Annual"; older rows store "1"/"2".
   const cadence = String(membership.billing_cadence || '').toLowerCase();
   if (['1', 'monthly'].includes(cadence)) endDate = addMonths(startDate, 1);
   else if (['2', 'annual', 'yearly'].includes(cadence)) endDate = addYears(startDate, 1);

   const [updated] = await req.db.$transaction([
      req.db.user.update({ where: { id: req.user.id }, data: { membershipId }, select: userPublic }),
      req.db.userMembershipHistory.create({
         data: { userId: req.user.id, membershipId, startDate, endDate },
      }),
   ]);

   res.json(updated);
};

// Members and admins update their own name, phone and password.
export const updateMe = async (req, res) => {
   const data = {};
   if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ message: 'Name cannot be empty' });
      data.name = name;
   }
   if (req.body.phone !== undefined) {
      const phone = String(req.body.phone).trim();
      if (!phone) return res.status(400).json({ message: 'Phone cannot be empty' });
      const taken = await req.db.user.findFirst({ where: { phone, NOT: { id: req.user.id } }, select: { id: true } });
      if (taken) return res.status(400).json({ message: 'Phone already in use' });
      data.phone = phone;
   }
   if (req.body.newPassword) {
      if (String(req.body.newPassword).length < 8) {
         return res.status(400).json({ message: 'New password must be at least 8 characters' });
      }
      const current = await req.db.user.findFirst({ where: { id: req.user.id }, select: { password: true } });
      const ok = current && req.body.currentPassword
         ? await bcrypt.compare(String(req.body.currentPassword), current.password)
         : false;
      if (!ok) return res.status(400).json({ message: 'Current password is incorrect' });
      data.password = await bcrypt.hash(String(req.body.newPassword), 10);
   }

   const updated = await req.db.user.update({ where: { id: req.user.id }, data, select: userPublic });
   res.json(updated);
};
