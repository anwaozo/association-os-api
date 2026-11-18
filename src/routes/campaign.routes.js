import express from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import { getCampaigns, createCampaign, updateCampaign } from '../controllers/campaign.controller.js';
const router = express.Router();

router.get('/', authMiddleware, getCampaigns);
router.post('/', authMiddleware, requireAdmin, createCampaign);
router.put('/:id', authMiddleware, requireAdmin, updateCampaign);
export default router;
