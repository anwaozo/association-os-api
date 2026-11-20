import { ACTIVITY_TYPES } from '../utils/activity.js';

const PAGE_SIZE = 50;

// GET /api/notifications?type=donation&before=<id>
// Admin activity feed, newest first, 50 at a time.
export const listNotifications = async (req, res) => {
   const where = {};
   if (req.query.type) {
      const types = String(req.query.type).split(',').filter((t) => ACTIVITY_TYPES.includes(t));
      if (types.length) where.type = { in: types };
   }
   const before = Number(req.query.before);
   if (Number.isInteger(before) && before > 0) where.id = { lt: before };

   const [items, me] = await Promise.all([
      req.db.activity.findMany({ where, orderBy: { id: 'desc' }, take: PAGE_SIZE + 1 }),
      req.db.user.findFirst({ where: { id: req.user.id }, select: { notificationsSeenAt: true } }),
   ]);

   const hasMore = items.length > PAGE_SIZE;
   const page = hasMore ? items.slice(0, PAGE_SIZE) : items;
   const seenAt = me?.notificationsSeenAt;
   res.json({
      items: page.map((a) => ({ ...a, unread: !seenAt || a.createdAt > seenAt })),
      nextBefore: hasMore ? page[page.length - 1].id : null,
   });
};

// GET /api/notifications/unread-count
export const unreadCount = async (req, res) => {
   const me = await req.db.user.findFirst({ where: { id: req.user.id }, select: { notificationsSeenAt: true } });
   const count = await req.db.activity.count({
      where: me?.notificationsSeenAt ? { createdAt: { gt: me.notificationsSeenAt } } : {},
   });
   res.json({ count });
};

// POST /api/notifications/seen  - marks everything up to now as read
export const markSeen = async (req, res) => {
   await req.db.user.update({ where: { id: req.user.id }, data: { notificationsSeenAt: new Date() }, select: { id: true } });
   res.json({ ok: true });
};
