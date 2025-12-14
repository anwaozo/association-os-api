// src/controllers/auth.controller.js
import bcrypt from 'bcryptjs';
import { prisma } from '../config/db.js';
import {
   signAccessToken,
   createRefreshTokenString,
   hashToken,
   REFRESH_EXPIRES_SECONDS
} from '../utils/tokens.js';
import dotenv from 'dotenv';
dotenv.config();

const REFRESH_COOKIE_NAME = 'jid';
const cookieOptions = {
   httpOnly: true,
   //secure: process.env.NODE_ENV === 'production',
   secure: false,
   sameSite: 'strict',
   path: '/api/auth/refresh',
   maxAge: REFRESH_EXPIRES_SECONDS * 1000
};

export const register = async (req, res) => {
   try {
      const { name, email, password, role, phone } = req.body;
      const exists = await prisma.user.findUnique({ where: { email } });
      if (exists) return res.status(400).json({ message: 'Email already in use' });

      const phone_exists = await prisma.user.findUnique({ where: { phone } });
      if (phone_exists) return res.status(400).json({ message: 'Phone already in use' });

      let hashed = '';

      if(password) {
         hashed = await bcrypt.hash(password, 10);
      } else {
         hashed = await bcrypt.hash(phone, 10);
      }

      const user = await prisma.user.create({
         data: { name, email, phone, password: hashed, role: role ? Number(role) : null, },
         select: { id: true, name: true, email: true, role: true }
      });

      res.status(201).json(user);
   } catch (err) {
      res.status(500).json({ message: err.message });
   }
};

export const update = async (req, res) => {
   try {
      const id = Number(req.params.id);
      const { name, email, password, role, phone } = req.body;

      const updated = await prisma.user.update({
         where: { id },
         data: {
            name,
            email,
            phone,
            role: role ? Number(role) : null,
         },
      });
      res.status(200).json(updated);
   } catch (err) {
      res.status(500).json({ message: err.message });
   }
};

export const bulk_register = async (req, res) => {
   req.setTimeout(0);
   res.setTimeout(0);
   try {
      const { users } = req.body;

      if (!Array.isArray(users) || users.length === 0) {
         return res.status(400).json({ message: "Invalid users array" });
      }

      const formattedUsers = await Promise.all(
         users.map(async (u) => ({
            name: u.name,
            email: u.email,
            phone: u.phone,
            role: u.role ? Number(u.role) : null,
            password: await bcrypt.hash(u.phone, 10),
         }))
      );

      // Insert many users
      const created = await prisma.user.createMany({
         data: formattedUsers,
         skipDuplicates: true, // avoids unique email errors
      });

      res.status(200).json({
         message: `${created.count} users imported successfully`,
         count: created.count
      });
   } catch (error) {
      console.error("Bulk register error:", error);
      res.status(500).json({ error: "Failed to import users" });
   }
};

export const login = async (req, res) => {
   try {
      const { email, password } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return res.status(401).json({ message: 'Email not found' });

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(401).json({ message: 'Entered password incorrect' });

      const accessToken = signAccessToken({ id: user.id, email: user.email, role: user.role });

      const refresh = createRefreshTokenString();
      const tokenHash = hashToken(refresh);
      const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_SECONDS * 1000);

      await prisma.refreshToken.create({
         data: {
         tokenHash,
         userId: user.id,
         expiresAt
         }
      });

      res.cookie(REFRESH_COOKIE_NAME, refresh, cookieOptions);

      return res.json({
         accessToken,
         tokenHash,
         user: { id: user.id, email: user.email, name: user.name, role: user.role }
      });
   } catch (err) {
      res.status(500).json({ message: err.message });
   }
};

export const refresh = async (req, res) => {
   try {
      const incoming = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
      if (!incoming) return res.status(401).json({ message: 'No refresh token' });

      const incomingHash = hashToken(incoming);
      const tokenRecord = await prisma.refreshToken.findUnique({ where: { tokenHash: incomingHash } });

      if (!tokenRecord) {
         // Unknown token => possible theft. Defensive action could be taken here.
         return res.status(403).json({ message: 'Invalid refresh token' });
      }

      if (tokenRecord.revoked) {
         // Reuse detection — revoke all tokens for this user
         await prisma.refreshToken.updateMany({
            where: { userId: tokenRecord.userId },
            data: { revoked: true }
         });
         return res.status(403).json({ message: 'Refresh token revoked. Re-authenticate.' });
      }

      if (new Date() > tokenRecord.expiresAt) {
         await prisma.refreshToken.update({
            where: { id: tokenRecord.id },
            data: { revoked: true }
         });
         return res.status(403).json({ message: 'Refresh token expired' });
      }

      // Rotate: create new refresh token, revoke old, issue new access token
      const newRefresh = createRefreshTokenString();
      const newHash = hashToken(newRefresh);
      const newExpiresAt = new Date(Date.now() + REFRESH_EXPIRES_SECONDS * 1000);

      const created = await prisma.refreshToken.create({
         data: {
            tokenHash: newHash,
            userId: tokenRecord.userId,
            expiresAt: newExpiresAt
         }
      });

      await prisma.refreshToken.update({
         where: { id: tokenRecord.id },
         data: { revoked: true, replacedBy: created.id }
      });

      const user = await prisma.user.findUnique({ where: { id: tokenRecord.userId } });

      const accessToken = signAccessToken({ id: user.id, email: user.email, role: user.role });

      // set cookie with new refresh token
      res.cookie(REFRESH_COOKIE_NAME, newRefresh, cookieOptions);

      return res.json({ accessToken });
   } catch (err) {
      res.status(500).json({ message: err.message });
   }
};

export const logout = async (req, res) => {
   try {
      const incoming = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
      if (incoming) {
         const incomingHash = hashToken(incoming);
         const tokenRecord = await prisma.refreshToken.findUnique({ where: { tokenHash: incomingHash } });
         if (tokenRecord) {
         await prisma.refreshToken.update({
            where: { id: tokenRecord.id },
            data: { revoked: true }
         });
         }
      }

      // clear cookie
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth/refresh' });
      return res.json({ message: 'Logged out' });
   } catch (err) {
      res.status(500).json({ message: err.message });
   }
};
