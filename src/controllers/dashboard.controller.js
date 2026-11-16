import { userMini } from '../utils/selects.js';
import { ROLES } from '../middleware/auth.js';

const startOfToday = () => {
   const d = new Date();
   d.setUTCHours(0, 0, 0, 0);
   return d;
};

export const getDashboard = async (req, res) => {
   const today = startOfToday();
   const db = req.db;

   const in30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

   const [upcomingEvents, upcoming_count, members_count, contacts_count, campaigns_count, tiers_count,
      expiringSoon, newPeople, recentRsvps, recentCampaigns, campaignGoals] =
      await Promise.all([
         db.event.findMany({
            where: { date: { gte: today } },
            orderBy: { date: 'asc' },
            take: 3,
            include: {
               rsvps: { include: { user: { select: userMini } } },
               _count: { select: { rsvps: true } },
            },
         }),
         db.event.count({ where: { date: { gte: today } } }),
         db.user.count({ where: { role: ROLES.MEMBER } }),
         db.user.count({ where: { role: ROLES.CONTACT } }),
         db.campaign.count(),
         db.membership.count(),
         // Renewals due in the next 30 days
         db.userMembershipHistory.findMany({
            where: { endDate: { gte: today, lte: in30 } },
            orderBy: { endDate: 'asc' },
            take: 5,
            include: { user: { select: userMini }, membership: { select: { id: true, name: true } } },
         }),
         db.user.findMany({
            where: { role: { in: [ROLES.MEMBER, ROLES.CONTACT] } },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: { id: true, name: true, role: true, createdAt: true },
         }),
         db.rsvp.findMany({
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: { user: { select: { name: true } }, event: { select: { title: true } } },
         }),
         db.campaign.findMany({ orderBy: { id: 'desc' }, take: 3, select: { name: true, createdAt: true } }),
         db.campaign.aggregate({ _sum: { goal: true } }),
      ]);

   const recentActivity = [
      ...newPeople.map((u) => ({
         type: 'person',
         title: `New ${u.role === ROLES.MEMBER ? 'member' : 'contact'}: ${u.name || 'Unnamed'}`,
         at: u.createdAt,
      })),
      ...recentRsvps.map((r) => ({
         type: 'rsvp',
         title: `RSVP: ${r.user?.name || 'A member'} for ${r.event?.title}`,
         at: r.createdAt,
      })),
      ...recentCampaigns.map((c) => ({ type: 'campaign', title: `Campaign created: ${c.name}`, at: c.createdAt })),
   ]
      .filter((a) => a.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 6);

   const expiring_count = await db.userMembershipHistory.count({ where: { endDate: { gte: today, lte: in30 } } });

   return res.json({
      upcomingEvents,
      upcoming_count,
      members_count,
      contacts_count,
      campaigns_count,
      tiers_count,
      expiring_count,
      expiringSoon,
      recentActivity,
      campaign_goal_total: campaignGoals._sum.goal || 0,
   });
};
