import express from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import { getDashboard } from '../controllers/dashboard.controller.js';
const router = express.Router();

router.get('/', authMiddleware, requireAdmin, getDashboard);
export default router;
