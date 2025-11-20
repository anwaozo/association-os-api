// src/controllers/admin.user.controller.js
import { prisma } from '../config/db.js';
import bcrypt from 'bcryptjs';
import { addDays, addMonths, addYears } from "date-fns";

export const getAllUsers = async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true }
  });
  res.json(users);
};

export const getUserById = async (req, res) => {
   const id = Number(req.params.id);
   const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, createdAt: true }
   });
   if (!user) return res.status(404).json({ message: 'User not found' });
   res.json(user);
};

export const updateUser = async (req, res) => {
   const id = Number(req.params.id);
   const { name, role, password } = req.body;

   const data = {};
   if (name) data.name = name;
   if (role) data.role = role;
   if (password) data.password = await bcrypt.hash(password, 10);

   const updated = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true }
   });

   res.json(updated);
};

export const deleteUser = async (req, res) => {
  const id = Number(req.params.id);
  await prisma.user.delete({ where: { id } });
  // optionally also revoke user's refresh tokens
  await prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
  res.json({ message: 'User deleted' });
};

export const userDashboard = async (req, res) => {
   
   try {

      const user = await prisma.user.findUnique({
         where: { id: req.user.id },
         select: {
            id: true,
            name: true,
            email: true,

            membership: {
               select: {
                  id: true,
                  name: true,
               }
            },

            rsvps: {
               include: {
                  event: true
               }
            }
         }
      });

      const lastMembershipHistory = await prisma.userMembershipHistory.findFirst({
         where: { userId: req.user.id },
         orderBy: { createdAt: "desc" },
         include: {
            membership: true
         }
      });

      const memberships = await prisma.membership.findMany();

      return res.json({
         ...user,
         membershipHistory: lastMembershipHistory,
         memberships: memberships
      });

   } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
   }
}

export const updateMembership = async (req, res) => {
   try {
      const { membershipId } = req.body;

      if (!membershipId) {
         return res.status(400).json({ message: "membershipId is required" });
      }

      const updated = await prisma.user.update({
         where: { id: req.user.id },
         data: { membershipId }
      });

      const membership = await prisma.membership.findUnique({
         where: { id: membershipId },
         select: { billing_cadence: true }
      });

      const startDate = new Date();
      let endDate = null;

      switch (membership.billing_cadence) {
         case "1":
            endDate = addMonths(startDate, 1);
            break;
         case "2":
            endDate = addYears(startDate, 1);
            break;
         default:
            endDate = null;
      }

      await prisma.userMembershipHistory.create({
         data: {
            userId: req.user.id,
            membershipId: membershipId,
            startDate,
            endDate
         }
      });

      res.json(updated);
   } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
   }
}
