// src/routes/auth.routes.js
import express from 'express';
import { register, bulk_register, login, refresh, logout } from '../controllers/auth.controller.js';
const router = express.Router();

router.post('/register', register);
router.post('/bulk_register', bulk_register);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);

export default router;
