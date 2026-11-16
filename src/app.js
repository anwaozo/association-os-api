import express from 'express';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { prisma } from './config/db.js';
import { applySecurityMiddleware } from './middleware/security.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import contactRoutes from './routes/contact.routes.js';
import eventRoutes from './routes/event.routes.js';
import membershipRoutes from './routes/membership.routes.js';
import campaignRoutes from './routes/campaign.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import { organizationRoutes, platformRoutes } from './routes/organization.routes.js';

const app = express();

// Behind Netlify / a load balancer: use the real client IP for rate limiting.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Netlify Functions may hand us the function path instead of the original one.
app.use((req, _res, next) => {
   const prefix = '/.netlify/functions/api';
   if (req.url.startsWith(prefix)) {
      const rest = req.url.slice(prefix.length) || '/';
      req.url = rest.startsWith('/api') ? rest : `/api${rest}`;
   }
   next();
});

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
if (env.NODE_ENV !== 'test') app.use(morgan(env.isProd ? 'tiny' : 'dev'));

applySecurityMiddleware(app);

app.get('/api/health', async (_req, res) => {
   try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: 'up' });
   } catch {
      res.status(503).json({ ok: false, db: 'down' });
   }
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/memberships', membershipRoutes);
app.use('/api/campaign', campaignRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/platform', platformRoutes);

app.get('/', (_req, res) => res.send('AssociationOS API'));

app.use(notFound);
app.use(errorHandler);

export default app;
