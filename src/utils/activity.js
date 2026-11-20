// Records an entry in the organization's activity feed (Notifications).
// Never throws: a failed log line must not fail the request that caused it.
//
//   await logActivity(req.db, { type: 'event_rsvp', actorId: req.user.id, title: '...', detail: '...' });
//
// `db` must be a tenant-scoped client (req.db or forTenant(orgId)), which
// stamps organizationId on the row.
export const ACTIVITY_TYPES = [
   'member_joined',
   'members_imported',
   'event_created',
   'event_rsvp',
   'membership_changed',
   'campaign_created',
   'donation',
   'message_sent',
];

export async function logActivity(db, { type, actorId = null, title, detail = null, meta = null }) {
   try {
      await db.activity.create({
         data: {
            type,
            actorId: actorId ?? null,
            title: String(title).slice(0, 300),
            detail: detail ? String(detail).slice(0, 1000) : null,
            meta: meta ?? undefined,
         },
      });
   } catch (err) {
      console.error('Activity log failed:', type, err?.message);
   }
}

export const formatMoney = (cents, currency = 'usd') =>
   new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format((cents || 0) / 100);
