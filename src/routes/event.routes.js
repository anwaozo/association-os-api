import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { createEvent, getAllEvents, getAllUserEvents, createRsvp } from '../controllers/event.controller.js';
const router = express.Router();

router.get('/', authMiddleware, getAllEvents);
router.get('/user', authMiddleware, getAllUserEvents);
router.post('/', authMiddleware, createEvent);
router.post('/rsvp', authMiddleware, createRsvp);
export default router;
