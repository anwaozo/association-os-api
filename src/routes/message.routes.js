import express from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import {
   getConfig, listTemplates, createTemplate, updateTemplate, deleteTemplate, previewAudience,
   listMessages, getMessage, createMessage, updateMessage, sendMessage, deleteMessage,
} from '../controllers/message.controller.js';

// Everything here is admin-only. The Resend webhook is mounted in app.js
// (it needs the raw request body and has no login).
const router = express.Router();
router.use(authMiddleware, requireAdmin);

router.get('/config', getConfig);
router.get('/templates', listTemplates);
router.post('/templates', createTemplate);
router.put('/templates/:id', updateTemplate);
router.delete('/templates/:id', deleteTemplate);
router.post('/audience-preview', previewAudience);

router.get('/', listMessages);
router.post('/', createMessage);
router.get('/:id', getMessage);
router.put('/:id', updateMessage);
router.post('/:id/send', sendMessage);
router.delete('/:id', deleteMessage);
export default router;
