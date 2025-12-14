import { prisma } from '../config/db.js';

export const getDashboard = async (req, res) => {
   const today = new Date();

   const upcoming_result = await prisma.event.findMany({
      where: {
         date: {
            gte: today
         }
      },
      orderBy: { date: 'asc' },
      take: 3,
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

   const upcoming_count = await prisma.event.count({
      where: {
         date: { gte: today }
      }
   });

   const members_count = await prisma.user.count({});

   return res.json({
      upcomingEvents: upcoming_result,
      upcoming_count: upcoming_count,
      members_count: members_count
   });
};

