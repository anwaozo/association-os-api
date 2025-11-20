import { prisma } from '../config/db.js';

export const getContacts = async (req, res) => {
   const contacts = await prisma.user.findMany({
      where: {
         role: { in: [2, 3] },
      },
   });
   res.json(contacts);
};

