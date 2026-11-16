import { env } from '../config/env.js';

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, _next) => {
   // Prisma known errors
   if (err?.code === 'P2002') {
      return res.status(409).json({ message: 'A record with these details already exists' });
   }
   if (err?.code === 'P2025') {
      return res.status(404).json({ message: 'Not found' });
   }
   if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ message: 'Invalid JSON body' });
   }
   const status = err?.status || err?.statusCode || 500;
   if (status >= 500) console.error(err);
   res.status(status).json({
      message: status >= 500 && env.isProd ? 'Server error' : err?.message || 'Server error',
   });
};

export const notFound = (req, res) => res.status(404).json({ message: 'Not found' });
