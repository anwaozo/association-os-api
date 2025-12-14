import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { createEvent, getAllEvents, getAllUserEvents, createRsvp, deleteRsvp, updateEvent } from '../controllers/event.controller.js';
const router = express.Router();

router.get('/', authMiddleware, getAllEvents);
router.get('/user', authMiddleware, getAllUserEvents);
router.post('/', authMiddleware, createEvent);
router.put('/:id', authMiddleware, updateEvent);
router.post('/rsvp', authMiddleware, createRsvp);
router.delete('/rsvp/:event_id', authMiddleware, deleteRsvp);
export default router;
