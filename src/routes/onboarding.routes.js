import express from 'express';
import rateLimit from 'express-rate-limit';
import { signup, getInvite, acceptInvite } from '../controllers/onboarding.controller.js';
import { clientKey } from '../middleware/security.js';

const router = express.Router();
const isTest = process.env.NODE_ENV === 'test';

const signupLimiter = rateLimit({
   windowMs: 60 * 60 * 1000,
   limit: isTest ? 1000 : 5,
   keyGenerator: clientKey,
   standardHeaders: 'draft-7',
   legacyHeaders: false,
   message: { message: 'Too many applications from this network. Try again later.' },
});

const inviteLimiter = rateLimit({
   windowMs: 15 * 60 * 1000,
   limit: isTest ? 1000 : 30,
   keyGenerator: clientKey,
   standardHeaders: 'draft-7',
   legacyHeaders: false,
   message: { message: 'Too many attempts. Try again in a few minutes.' },
});

router.post('/signup', signupLimiter, signup);
router.get('/invites/:token', inviteLimiter, getInvite);
router.post('/invites/:token/accept', inviteLimiter, acceptInvite);

export default router;
