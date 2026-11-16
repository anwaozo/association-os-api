import slugify from 'slugify';
import { userMini } from '../utils/selects.js';

const startOfToday = () => {
   const d = new Date();
   d.setUTCHours(0, 0, 0, 0);
   return d;
};

const trimOrNull = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function eventData(body) {
   const title = trimOrNull(body.title);
   const description = trimOrNull(body.description) || '';
   if (!title) return { error: 'Title is required' };
   if (!body.date || Number.isNaN(new Date(body.date).getTime())) return { error: 'A valid date is required' };
   return {
      data: {
         title,
         slug: slugify(title, { lower: true, strict: true }),
         date: new Date(body.date),
         start_time: trimOrNull(body.start_time),
         end_time: trimOrNull(body.end_time),
         location: trimOrNull(body.location),
         capacity: body.capacity ? Number(body.capacity) : null,
         price: body.price ? Number(body.price) : null,
         description,
         isRSVP: Boolean(body.isRSVP),
         isPublic: Boolean(body.isPublic),
      },
   };
}

export const createEvent = async (req, res) => {
   const { data, error } = eventData(req.body);
   if (error) return res.status(400).json({ message: error });

   const existing = await req.db.event.findFirst({ where: { slug: data.slug }, select: { id: true } });
   if (existing) return res.status(400).json({ message: 'Event with this title already exists' });

   const event = await req.db.event.create({ data: { ...data, createdBy: req.user.id } });
   res.status(201).json(event);
};

export const updateEvent = async (req, res) => {
   const id = Number(req.params.id);
   if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid id' });

   const { data, error } = eventData(req.body);
   if (error) return res.status(400).json({ message: error });

   const existing = await req.db.event.findFirst({ where: { slug: data.slug }, select: { id: true } });
   if (existing && existing.id !== id) {
      return res.status(400).json({ message: 'Event with this title already exists' });
   }

   // Scoped: an event from another organization returns 404.
   const event = await req.db.event.update({ where: { id }, data });
   res.status(200).json(event);
};

export const getAllEvents = async (req, res) => {
   const events = await req.db.event.findMany({
      orderBy: { date: 'asc' },
      include: {
         rsvps: { include: { user: { select: userMini } } },
         _count: { select: { rsvps: true } },
      },
   });
   res.json(events);
};

export const getAllUserEvents = async (req, res) => {
   const today = startOfToday();

   const [upcomingResult, pastEvents, myRsvp] = await Promise.all([
      req.db.event.findMany({
         where: { date: { gte: today } },
         orderBy: { date: 'asc' },
         include: {
            rsvps: { where: { user_id: req.user.id } },
            _count: { select: { rsvps: true } },
         },
      }),
      req.db.event.findMany({
         where: { date: { lt: today } },
         orderBy: { date: 'desc' },
         include: { creator: { select: userMini } },
      }),
      req.db.rsvp.findMany({
         where: { user_id: req.user.id },
         include: { event: true },
      }),
   ]);

   const upcomingEvents = upcomingResult.map((event) => ({
      ...event,
      isAttending: event.rsvps.length > 0,
   }));

   return res.json({ upcomingEvents, pastEvents, myRsvp });
};

export const createRsvp = async (req, res) => {
   const eventId = Number(req.body.event_id);
   if (!Number.isInteger(eventId)) return res.status(400).json({ message: 'Invalid event' });

   // The event must belong to the caller's organization.
   const event = await req.db.event.findFirst({
      where: { id: eventId },
      include: { _count: { select: { rsvps: true } } },
   });
   if (!event) return res.status(404).json({ message: 'Event not found' });
   if (event.isRSVP === false) return res.status(400).json({ message: 'This event does not take RSVPs' });
   if (event.capacity && event._count.rsvps >= event.capacity) {
      return res.status(400).json({ message: 'This event is full' });
   }

   const existing = await req.db.rsvp.findFirst({ where: { user_id: req.user.id, event_id: eventId } });
   if (existing) return res.status(400).json({ message: "You already RSVP'd for this event" });

   const rsvp = await req.db.rsvp.create({ data: { user_id: req.user.id, event_id: eventId } });
   res.status(201).json(rsvp);
};

export const deleteRsvp = async (req, res) => {
   const eventId = Number(req.params.event_id);
   if (!Number.isInteger(eventId)) return res.status(400).json({ message: 'Invalid event' });

   const { count } = await req.db.rsvp.deleteMany({ where: { user_id: req.user.id, event_id: eventId } });
   if (count === 0) return res.status(404).json({ message: 'RSVP not found' });
   return res.status(200).json({ message: 'RSVP deleted successfully' });
};
