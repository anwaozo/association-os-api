import { userDirectory } from '../utils/selects.js';
import { ROLES } from '../middleware/auth.js';

// Members and contacts of the caller's organization.
// Admins use this for Contacts & Members; members use it for the directory.
export const getContacts = async (req, res) => {
   const isAdmin = req.user.role === ROLES.ADMIN;
   const contacts = await req.db.user.findMany({
      where: {
         role: { in: isAdmin ? [ROLES.MEMBER, ROLES.CONTACT] : [ROLES.MEMBER] },
         ...(isAdmin ? {} : { status: 1 }),
      },
      select: { ...userDirectory, status: isAdmin },
      orderBy: { id: 'desc' },
   });
   res.json(contacts);
};
