import { prisma } from '../config/db.js';
import slugify from "slugify";

export const getCampaigns = async (req, res) => {
   const campaigns = await prisma.campaign.findMany();
   res.json(campaigns);
};

export const createCampaign = async (req, res) => {
   const { name, goal, date, donation_amount, capacity, price, description, isCustomAmount, isPublic, isAnonymous, isEmailNotifiy, isRecurring, thank_you } = req.body;
   const slug = slugify(name, { lower: true, strict: true });

   const existing = await prisma.campaign.findUnique({ where: { slug } });
   if (existing) {
      return res.status(400).json({ message: "Campaign with this title already exists" });
   }

   const parsedDonationAmount = (() => {
      try {
         return donation_amount ? JSON.parse(donation_amount) : [];
      } catch (e) {
         return [];
      }
   })();

   const campaign = await prisma.campaign.create({
      data: {
         name,
         slug,
         goal: goal ? Number(goal) : null,
         date: new Date(date),
         donation_amount: parsedDonationAmount,
         capacity: capacity ? Number(capacity) : null,
         price: price ? Number(price) : null,
         description,
         isCustomAmount: Boolean(isCustomAmount),
         isPublic: Boolean(isPublic),
         isAnonymous: Boolean(isAnonymous),
         isEmailNotifiy: Boolean(isEmailNotifiy),
         isRecurring: Boolean(isRecurring),
         thank_you
      },
   });
   res.status(201).json(campaign);
};
