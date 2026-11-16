import express from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import { getMemberships, createMembership, updateMembership } from '../controllers/membership.controller.js';
const router = express.Router();

router.get('/', authMiddleware, getMemberships);
router.post('/', authMiddleware, requireAdmin, createMembership);
router.put('/:id', authMiddleware, requireAdmin, updateMembership);
export default router;
