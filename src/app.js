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
import onboardingRoutes from './routes/onboarding.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import messageRoutes from './routes/message.routes.js';
import { paymentRoutes, donationRoutes, publicRoutes } from './routes/payment.routes.js';
import { stripeWebhook } from './controllers/payment.controller.js';
import { resendWebhook } from './controllers/message.controller.js';

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

// Webhooks verify a signature over the exact bytes, so they get the raw body
// and skip JSON parsing and input sanitizing.
app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }), stripeWebhook);
app.post('/api/messages/webhook/resend', express.raw({ type: '*/*', limit: '1mb' }), resendWebhook);

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
if (env.NODE_ENV !== 'test') app.use(morgan(env.isProd ? 'tiny' : 'dev'));

applySecurityMiddleware(app);

app.get('/api/health', async (_req, res) => {
   try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: 'up' });
   } catch (err) {
      // Report why the database is unreachable, never the connection string.
      // e.g. 28P01 = wrong password, ENOTFOUND = bad host, ETIMEDOUT = network/SSL.
      const driver = err?.meta?.driverAdapterError?.cause;
      const code = driver?.originalCode || driver?.kind || err?.code || 'UNKNOWN';
      const message = String(driver?.originalMessage || driver?.kind || err?.message || '')
         .replace(/postgres(ql)?:\/\/[^\s"']+/gi, '[connection string]')
         .slice(0, 300);
      console.error('Health check failed:', code, message);
      res.status(503).json({ ok: false, db: 'down', error: { code, message } });
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
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/public', publicRoutes);

app.get('/', (_req, res) => res.send('AssociationOS API'));

app.use(notFound);
app.use(errorHandler);

export default app;
