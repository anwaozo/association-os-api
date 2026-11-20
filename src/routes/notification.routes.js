import express from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import { listNotifications, unreadCount, markSeen } from '../controllers/notification.controller.js';
const router = express.Router();

router.get('/', authMiddleware, requireAdmin, listNotifications);
router.get('/unread-count', authMiddleware, requireAdmin, unreadCount);
router.post('/seen', authMiddleware, requireAdmin, markSeen);
export default router;
