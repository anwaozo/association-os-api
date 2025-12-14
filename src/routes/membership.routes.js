import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getMemberships, createMembership, updateMembership } from '../controllers/membership.controller.js';
const router = express.Router();


router.get('/', authMiddleware, getMemberships);
router.post('/', authMiddleware, createMembership);
router.put('/:id', authMiddleware, updateMembership);
export default router;
