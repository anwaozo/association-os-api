import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getContacts } from '../controllers/contact.controller.js';
const router = express.Router();

router.get('/', authMiddleware, getContacts);
export default router;
