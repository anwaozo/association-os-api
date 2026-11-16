import slugify from 'slugify';

export const getCampaigns = async (req, res) => {
   const campaigns = await req.db.campaign.findMany({ orderBy: { id: 'desc' } });
   res.json(campaigns);
};

const parseDonationAmounts = (v) => {
   if (Array.isArray(v)) return v;
   try {
      const parsed = v ? JSON.parse(v) : [];
      return Array.isArray(parsed) ? parsed : [];
   } catch {
      return [];
   }
};

export const createCampaign = async (req, res) => {
   const b = req.body;
   const name = typeof b.name === 'string' ? b.name.trim() : '';
   if (!name) return res.status(400).json({ message: 'Name is required' });
   if (!b.date || Number.isNaN(new Date(b.date).getTime())) {
      return res.status(400).json({ message: 'A valid date is required' });
   }

   const slug = slugify(name, { lower: true, strict: true });
   const existing = await req.db.campaign.findFirst({ where: { slug }, select: { id: true } });
   if (existing) return res.status(400).json({ message: 'Campaign with this title already exists' });

   const campaign = await req.db.campaign.create({
      data: {
         name,
         slug,
         goal: Number(b.goal) || 0,
         date: new Date(b.date),
         donation_amount: parseDonationAmounts(b.donation_amount),
         capacity: Number(b.capacity) || 0,
         price: b.price ? Number(b.price) : null,
         description: typeof b.description === 'string' ? b.description.trim() : '',
         isCustomAmount: Boolean(b.isCustomAmount),
         isPublic: Boolean(b.isPublic),
         isAnonymous: Boolean(b.isAnonymous),
         isEmailNotifiy: Boolean(b.isEmailNotifiy),
         isRecurring: Boolean(b.isRecurring),
         thank_you: typeof b.thank_you === 'string' ? b.thank_you : '',
      },
   });
   res.status(201).json(campaign);
};
