import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

export const signAccessToken = (payload) =>
   jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });

export const verifyToken = (token) =>
   jwt.verify(token, process.env.JWT_SECRET);
