import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import cors from 'cors';
import { env } from '../config/env.js';

function sanitizeValue(value) {
   if (typeof value === 'string') {
      return value.replace(/[<>$]/g, '');
   }
   if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) {
         value[key] = sanitizeValue(value[key]);
      }
   }
   return value;
}

function sanitizeRequest(req, _res, next) {
   sanitizeValue(req.body);
   sanitizeValue(req.params);
   sanitizeValue(req.query);
   next();
}

// Origins may include a wildcard subdomain, e.g. https://*.netlify.app
const originMatchers = env.CORS_ORIGINS.map((o) => {
   if (!o.includes('*')) return (origin) => origin === o;
   const re = new RegExp('^' + o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+') + '$');
   return (origin) => re.test(origin);
});

// Netlify sends the real client IP in x-nf-client-connection-ip.
export const clientKey = (req) =>
   ipKeyGenerator(req.headers['x-nf-client-connection-ip'] || req.ip || req.socket?.remoteAddress || '0.0.0.0');

export const applySecurityMiddleware = (app) => {
   app.use(helmet());
   app.use(
      cors({
         origin(origin, cb) {
            // Non-browser clients (curl, server-to-server) send no Origin.
            if (!origin || originMatchers.some((m) => m(origin))) return cb(null, true);
            return cb(null, false);
         },
         credentials: true,
         methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
         allowedHeaders: ['Content-Type', 'Authorization'],
      })
   );
   app.use(sanitizeRequest);
   app.use(
      rateLimit({
         windowMs: 15 * 60 * 1000,
         limit: env.RATE_LIMIT_MAX,
         keyGenerator: clientKey,
         standardHeaders: 'draft-7',
         legacyHeaders: false,
         message: { message: 'Too many requests, please try again later.' },
      })
   );
};
