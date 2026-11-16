import express from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import { getCampaigns, createCampaign } from '../controllers/campaign.controller.js';
const router = express.Router();

router.get('/', authMiddleware, getCampaigns);
router.post('/', authMiddleware, requireAdmin, createCampaign);
export default router;
