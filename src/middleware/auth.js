import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

export const authMiddleware = (req, res, next) => {
   const authHeader = req.headers.authorization;
   if (!authHeader?.startsWith('Bearer '))
      return res.status(401).json({ message: 'Unauthorized' });

   const token = authHeader.split(' ')[1];
   try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      next();
   } catch {
      res.status(403).json({ message: 'Invalid or expired token' });
   }
};

export const roleCheck = (...roles) => {
   return (req, res, next) => {
      if (!roles.includes(req.user.role))
         return res.status(403).json({ message: 'Forbidden' });
      next();
   };
};
