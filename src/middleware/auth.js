import { verifyAccessToken } from '../utils/tokens.js';
import { forTenant } from '../config/db.js';

export const ROLES = { ADMIN: 1, MEMBER: 2, CONTACT: 3 };

// Verifies the access token and attaches the tenant context:
//   req.user  - token claims
//   req.orgId - the caller's organization
//   req.db    - Prisma client locked to that organization
export const authMiddleware = (req, res, next) => {
   const authHeader = req.headers.authorization;
   if (!authHeader?.startsWith('Bearer '))
      return res.status(401).json({ message: 'Unauthorized' });

   let decoded;
   try {
      decoded = verifyAccessToken(authHeader.slice(7));
   } catch {
      return res.status(401).json({ message: 'Invalid or expired token' });
   }

   // Tokens issued before multi-tenancy have no organization: force re-login.
   if (!decoded.organizationId) {
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
   }

   req.user = decoded;
   req.orgId = Number(decoded.organizationId);
   req.db = forTenant(req.orgId);
   next();
};

export const requireRole = (...roles) => (req, res, next) => {
   if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
   if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'Forbidden' });
   next();
};

export const requireAdmin = requireRole(ROLES.ADMIN);

export const requirePlatformAdmin = (req, res, next) => {
   if (!req.user?.isPlatformAdmin) return res.status(403).json({ message: 'Forbidden' });
   next();
};
