import slugify from 'slugify';
import { logActivity, formatMoney } from '../utils/activity.js';

// Each campaign carries what it has raised so far (succeeded donations).
export const getCampaigns = async (req, res) => {
   const [campaigns, totals] = await Promise.all([
      req.db.campaign.findMany({ orderBy: { id: 'desc' } }),
      req.db.donation.groupBy({
         by: ['campaignId'],
         where: { status: 'succeeded', campaignId: { not: null } },
         _sum: { amountCents: true },
         _count: { _all: true },
      }),
   ]);
   const byId = new Map(totals.map((t) => [t.campaignId, t]));
   res.json(campaigns.map((c) => ({
      ...c,
      raisedCents: byId.get(c.id)?._sum.amountCents || 0,
      donationCount: byId.get(c.id)?._count._all || 0,
   })));
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

// Validates a create/update body. Returns { data } or { error }.
function campaignData(b) {
   const name = typeof b.name === 'string' ? b.name.trim() : '';
   if (!name) return { error: 'Name is required' };
   if (!b.date || Number.isNaN(new Date(b.date).getTime())) return { error: 'A valid date is required' };
   return {
      data: {
         name,
         slug: slugify(name, { lower: true, strict: true }),
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
   };
}

export const createCampaign = async (req, res) => {
   const { data, error } = campaignData(req.body);
   if (error) return res.status(400).json({ message: error });

   const existing = await req.db.campaign.findFirst({ where: { slug: data.slug }, select: { id: true } });
   if (existing) return res.status(400).json({ message: 'Campaign with this title already exists' });

   const campaign = await req.db.campaign.create({ data });
   await logActivity(req.db, {
      type: 'campaign_created',
      actorId: req.user.id,
      title: `New campaign: ${campaign.name}`,
      detail: campaign.goal ? `Goal ${formatMoney(Math.round(campaign.goal * 100))}` : null,
      meta: { campaignId: campaign.id },
   });
   res.status(201).json(campaign);
};

export const updateCampaign = async (req, res) => {
   const id = Number(req.params.id);
   if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });

   const { data, error } = campaignData(req.body);
   if (error) return res.status(400).json({ message: error });

   // Scoped to the caller's organization: another org's campaign is "not found".
   const current = await req.db.campaign.findFirst({ where: { id }, select: { id: true } });
   if (!current) return res.status(404).json({ message: 'Campaign not found' });

   const clash = await req.db.campaign.findFirst({ where: { slug: data.slug }, select: { id: true } });
   if (clash && clash.id !== id) return res.status(400).json({ message: 'Campaign with this title already exists' });

   const campaign = await req.db.campaign.update({ where: { id }, data });
   res.status(200).json(campaign);
};
