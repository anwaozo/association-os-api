// src/controllers/admin.user.controller.js
import { prisma } from '../config/db.js';
import bcrypt from 'bcryptjs';

export const getAllUsers = async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true }
  });
  res.json(users);
};

export const getUserById = async (req, res) => {
  const id = Number(req.params.id);
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, createdAt: true }
  });
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json(user);
};

export const updateUser = async (req, res) => {
  const id = Number(req.params.id);
  const { name, role, password } = req.body;

  const data = {};
  if (name) data.name = name;
  if (role) data.role = role;
  if (password) data.password = await bcrypt.hash(password, 10);

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true }
  });

  res.json(updated);
};

export const deleteUser = async (req, res) => {
  const id = Number(req.params.id);
  await prisma.user.delete({ where: { id } });
  // optionally also revoke user's refresh tokens
  await prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
  res.json({ message: 'User deleted' });
};
