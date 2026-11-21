import express from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import {
   getStatus, connect, dashboardLink, memberCheckout, publicCampaign, publicCheckout, availability, refundDonation,
} from '../controllers/payment.controller.js';
import {
   listDonations, donationSummary, recordDonation, deleteDonation, myDonations,
} from '../controllers/donation.controller.js';
import { rateLimit } from 'express-rate-limit';
import { clientKey } from '../middleware/security.js';

// /api/payments - Stripe Connect for org admins
export const paymentRoutes = express.Router();
paymentRoutes.get('/status', authMiddleware, requireAdmin, getStatus);
paymentRoutes.post('/connect', authMiddleware, requireAdmin, connect);
paymentRoutes.post('/dashboard', authMiddleware, requireAdmin, dashboardLink);

// /api/donations
export const donationRoutes = express.Router();
donationRoutes.get('/mine', authMiddleware, myDonations);
donationRoutes.get('/availability', authMiddleware, availability);
donationRoutes.post('/checkout', authMiddleware, memberCheckout);
donationRoutes.get('/summary', authMiddleware, requireAdmin, donationSummary);
donationRoutes.get('/', authMiddleware, requireAdmin, listDonations);
donationRoutes.post('/', authMiddleware, requireAdmin, recordDonation);
donationRoutes.delete('/:id', authMiddleware, requireAdmin, deleteDonation);
donationRoutes.post('/:id/refund', authMiddleware, requireAdmin, refundDonation);

// /api/public - no login (public campaign pages)
const checkoutLimiter = rateLimit({
   windowMs: 15 * 60 * 1000,
   limit: 20,
   keyGenerator: clientKey,
   standardHeaders: 'draft-7',
   legacyHeaders: false,
   message: { message: 'Too many attempts, please try again later.' },
});
export const publicRoutes = express.Router();
publicRoutes.get('/:orgSlug/campaigns/:slug', publicCampaign);
publicRoutes.post('/:orgSlug/campaigns/:slug/checkout', checkoutLimiter, publicCheckout);
