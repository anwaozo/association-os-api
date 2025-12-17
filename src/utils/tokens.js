// src/utils/tokens.js
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

export const ACCESS_EXPIRES = '2d';
export const REFRESH_EXPIRES_SECONDS = 30 * 24 * 60 * 60; // 30 days

export const signAccessToken = (payload) =>
   jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_EXPIRES });

// Refresh tokens are random strings (not JWT)
export const createRefreshTokenString = () =>
   crypto.randomBytes(64).toString('hex'); // 128 chars

export const hashToken = (token) =>
   crypto.createHash('sha256').update(token).digest('hex');
