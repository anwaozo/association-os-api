import { prisma } from '../config/db.js';
import slugify from "slugify";

const toTime = (timeStr) => {
  if (!timeStr) return null; 
  return new Date(`1970-01-01T${timeStr}:00Z`);
};

export const createEvent = async (req, res) => {
   const { title, description, date, start_time, end_time, location, capacity, price, isRSVP, isPublic } = req.body;
   const slug = slugify(title, { lower: true, strict: true });

   const existing = await prisma.event.findUnique({ where: { slug } });
   if (existing) {
      return res.status(400).json({ message: "Event with this title already exists" });
   }

   const event = await prisma.event.create({
      data: {
         title,
         slug,
         date: new Date(date), // Prisma needs Date object
         start_time: toTime(start_time),
         end_time: toTime(end_time),
         location,
         capacity: capacity ? Number(capacity) : null,
         price: price ? Number(price) : null,
         description,
         isRSVP: Boolean(isRSVP),
         isPublic: Boolean(isPublic),
         createdBy: req.user.id,
      },
   });
   res.status(201).json(event);
};

export const getAllEvents = async (req, res) => {
   const events = await prisma.event.findMany({
      orderBy: { date: 'asc' },
         include: {
         rsvps: {
            include: {
               user: true,
            },
         },
         _count: {
            select: { rsvps: true },
         },
         },
      });
   res.json(events);
};

export const getAllUserEvents = async (req, res) => {
   try {
      const today = new Date();  // current date & time

      const upcoming_result = await prisma.event.findMany({
         where: {
            date: {
               gte: today
            }
         },
         orderBy: { date: 'asc' },
         include: { 
            rsvps: {
               where: { user_id: req.user.id }
            }
         }
      });

      const upcoming = upcoming_result.map(event => ({
         ...event,
         isAttending: event.rsvps.length > 0 
      }));

      const past = await prisma.event.findMany({
         where: {
            date: {
               lt: today
            }
         },
         orderBy: { date: 'desc' },
         include: { creator: true }
      });

      return res.json({
         upcomingEvents: upcoming,
         pastEvents: past
      });

   } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
   }
};

export const createRsvp = async (req, res) => {
   const { event_id } = req.body;

   const existing = await prisma.rsvp.findUnique({
      where: {
         user_id_event_id: {
            user_id: req.user.id,
            event_id: Number(event_id),
         }
      }
   });

   if (existing) {
      return res.status(400).json({ message: "You already RSVP'd for this event" });
   }

   const rsvp = await prisma.rsvp.create({
      data: {
         user_id: req.user.id,
         event_id: Number(event_id),
      },
   });
   res.status(201).json(rsvp);
};
