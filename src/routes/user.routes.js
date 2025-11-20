import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { prisma } from '../config/db.js';
const router = express.Router();

router.get('/me', authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true, role: true }
  });
  res.json(user);
});
export default router;
