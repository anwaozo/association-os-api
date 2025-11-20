import { prisma } from '../config/db.js';
import slugify from "slugify";

export const getMemberships = async (req, res) => {
   const memberships = await prisma.membership.findMany();
   res.json(memberships);
};

export const createMembership = async (req, res) => {
   const { name, price, billing_cadence, benefits, auto_renewal } = req.body;
   const slug = slugify(name, { lower: true, strict: true });

   const existing = await prisma.membership.findUnique({ where: { slug } });
   if (existing) {
      return res.status(400).json({ message: "Membership with this title already exists" });
   }

   const event = await prisma.membership.create({
      data: {
         name,
         slug,
         price: price ? Number(price) : null,
         billing_cadence,
         benefits,
         auto_renewal: Boolean(auto_renewal),
         createdBy: req.user.id,
      },
   });
   res.status(201).json(event);
};
