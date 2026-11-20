import { logActivity, formatMoney } from '../utils/activity.js';
import { toCents, MIN_DONATION_CENTS, MAX_DONATION_CENTS } from '../utils/stripe.js';
import { userMini } from '../utils/selects.js';

const OFFLINE_METHODS = ['cash', 'check', 'other'];
const STATUSES = ['pending', 'succeeded', 'failed', 'refunded'];

const donationInclude = {
   campaign: { select: { id: true, name: true, slug: true } },
   user: { select: userMini },
};

// GET /api/donations?campaignId=&status=  (admin)
export const listDonations = async (req, res) => {
   const where = {};
   const campaignId = Number(req.query.campaignId);
   if (Number.isInteger(campaignId) && campaignId > 0) where.campaignId = campaignId;
   if (STATUSES.includes(req.query.status)) where.status = req.query.status;
   else where.status = { in: ['succeeded', 'refunded'] }; // abandoned checkouts are noise
   const donations = await req.db.donation.findMany({
      where,
      orderBy: [{ paidAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: 1000,
      include: donationInclude,
   });
   res.json(donations);
};

// GET /api/donations/summary  (admin) - numbers for the Fundraising overview
export const donationSummary = async (req, res) => {
   const now = new Date();
   const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
   const yearAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
   const ok = { status: 'succeeded' };

   const [total, thisMonth, donors, recent, byCampaign] = await Promise.all([
      req.db.donation.aggregate({ where: ok, _sum: { amountCents: true }, _count: { _all: true } }),
      req.db.donation.aggregate({ where: { ...ok, paidAt: { gte: monthStart } }, _sum: { amountCents: true } }),
      req.db.donation.findMany({ where: ok, select: { userId: true, donorEmail: true, donorName: true }, take: 50000 }),
      req.db.donation.findMany({ where: { ...ok, paidAt: { gte: yearAgo } }, select: { amountCents: true, paidAt: true } }),
      req.db.donation.groupBy({ by: ['campaignId'], where: ok, _sum: { amountCents: true }, _count: { _all: true } }),
   ]);

   const donorKeys = new Set(donors.map((d) => (d.userId ? `u${d.userId}` : (d.donorEmail || d.donorName || '').toLowerCase())).filter(Boolean));

   // Last 12 months, oldest first.
   const months = [];
   for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString('en-US', { month: 'short' }), amountCents: 0 });
   }
   const idx = new Map(months.map((m, i) => [m.key, i]));
   for (const r of recent) {
      const d = new Date(r.paidAt);
      const i = idx.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (i !== undefined) months[i].amountCents += r.amountCents;
   }

   const count = total._count._all;
   const sum = total._sum.amountCents || 0;
   res.json({
      totalRaisedCents: sum,
      thisMonthCents: thisMonth._sum.amountCents || 0,
      donationCount: count,
      donorCount: donorKeys.size,
      averageCents: count ? Math.round(sum / count) : 0,
      monthly: months.map(({ label, amountCents }) => ({ label, amountCents })),
      byCampaign: byCampaign.map((c) => ({ campaignId: c.campaignId, raisedCents: c._sum.amountCents || 0, count: c._count._all })),
   });
};

// POST /api/donations  (admin) - record an offline gift
// { amount, method: cash|check|other, campaignId?, userId?, donorName?, donorEmail?, date?, note?, isAnonymous? }
export const recordDonation = async (req, res) => {
   const b = req.body;
   const amountCents = toCents(b.amount);
   if (!amountCents || amountCents < MIN_DONATION_CENTS) return res.status(400).json({ message: 'Enter an amount of at least $1' });
   if (amountCents > MAX_DONATION_CENTS) return res.status(400).json({ message: 'Amount is too large' });
   if (!OFFLINE_METHODS.includes(b.method)) return res.status(400).json({ message: 'Choose how the gift was received (cash, check or other)' });

   let campaign = null;
   if (b.campaignId) {
      campaign = await req.db.campaign.findFirst({ where: { id: Number(b.campaignId) }, select: { id: true, name: true } });
      if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
   }
   let user = null;
   if (b.userId) {
      user = await req.db.user.findFirst({ where: { id: Number(b.userId) }, select: { id: true, name: true, email: true } });
      if (!user) return res.status(404).json({ message: 'Person not found' });
   }
   const donorName = (user?.name || String(b.donorName || '').trim()).slice(0, 120) || null;
   if (!donorName) return res.status(400).json({ message: 'Enter the donor’s name or pick a member' });

   const paidAt = b.date ? new Date(b.date) : new Date();
   if (Number.isNaN(paidAt.getTime())) return res.status(400).json({ message: 'Invalid date' });

   const donation = await req.db.donation.create({
      data: {
         campaignId: campaign?.id ?? null,
         userId: user?.id ?? null,
         donorName,
         donorEmail: (user?.email || String(b.donorEmail || '').trim().toLowerCase()).slice(0, 200) || null,
         amountCents,
         method: b.method,
         status: 'succeeded',
         isAnonymous: Boolean(b.isAnonymous),
         note: b.note ? String(b.note).slice(0, 500) : null,
         createdById: req.user.id,
         paidAt,
      },
      include: donationInclude,
   });

   await logActivity(req.db, {
      type: 'donation',
      actorId: req.user.id,
      title: `${donation.isAnonymous ? 'An anonymous donor' : donorName} gave ${formatMoney(amountCents)}${campaign ? ` to ${campaign.name}` : ''}`,
      detail: `Recorded by an admin (${b.method})`,
      meta: { donationId: donation.id, campaignId: campaign?.id ?? null },
   });
   res.status(201).json(donation);
};

// DELETE /api/donations/:id  (admin) - offline gifts only; Stripe gifts are refunded in Stripe
export const deleteDonation = async (req, res) => {
   const id = Number(req.params.id);
   if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });
   const { count } = await req.db.donation.deleteMany({ where: { id, method: { in: OFFLINE_METHODS } } });
   if (!count) return res.status(404).json({ message: 'Donation not found, or it was made online (refund it in Stripe instead)' });
   res.json({ ok: true });
};

// GET /api/donations/mine  (any logged-in user)
export const myDonations = async (req, res) => {
   const donations = await req.db.donation.findMany({
      where: { userId: req.user.id, status: { in: ['succeeded', 'refunded'] } },
      orderBy: { id: 'desc' },
      include: { campaign: { select: { id: true, name: true } } },
   });
   res.json(donations);
};
