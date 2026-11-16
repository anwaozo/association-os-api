import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { me, updateMe, userDashboard, updateMembership } from '../controllers/user.controller.js';
const router = express.Router();

router.get('/me', authMiddleware, me);
router.put('/me', authMiddleware, updateMe);
router.get('/', authMiddleware, userDashboard);
router.post('/update_membership', authMiddleware, updateMembership);

export default router;
