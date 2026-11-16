// src/routes/auth.routes.js
import express from 'express';
import rateLimit from 'express-rate-limit';
import { register, update, bulk_register, login, refresh, logout } from '../controllers/auth.controller.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import { clientKey } from '../middleware/security.js';
const router = express.Router();

const loginLimiter = rateLimit({
   windowMs: 15 * 60 * 1000,
   limit: Number(process.env.LOGIN_RATE_LIMIT_MAX || (process.env.NODE_ENV === 'test' ? 1000 : 20)),
   keyGenerator: clientKey,
   standardHeaders: 'draft-7',
   legacyHeaders: false,
   message: { message: 'Too many login attempts. Try again in a few minutes.' },
});

router.post('/login', loginLimiter, login);
router.post('/refresh', refresh);
router.post('/logout', logout);

// Admin-only people management for the caller's organization.
router.post('/register', authMiddleware, requireAdmin, register);
router.put('/register/:id', authMiddleware, requireAdmin, update);
router.post('/bulk_register', authMiddleware, requireAdmin, bulk_register);

export default router;
