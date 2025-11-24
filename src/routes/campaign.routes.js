import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getCampaigns, createCampaign } from '../controllers/campaign.controller.js';
const router = express.Router();


router.get('/', authMiddleware, getCampaigns);
router.post('/', authMiddleware, createCampaign);
export default router;
