// src/utils/tokens.js
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const ACCESS_EXPIRES = '2d';
export const REFRESH_EXPIRES_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Every access token carries the user's organization. The API trusts
// organizationId only from this signed token, never from the request body.
export const accessTokenPayload = (user) => ({
   id: user.id,
   email: user.email,
   role: user.role,
   organizationId: user.organizationId,
   isPlatformAdmin: Boolean(user.isPlatformAdmin),
});

export const signAccessToken = (user) =>
   jwt.sign(accessTokenPayload(user), env.JWT_SECRET, { expiresIn: ACCESS_EXPIRES });

export const verifyAccessToken = (token) => jwt.verify(token, env.JWT_SECRET);

// Refresh tokens are random strings (not JWT); only their hash is stored.
export const createRefreshTokenString = () =>
   crypto.randomBytes(64).toString('hex');

export const hashToken = (token) =>
   crypto.createHash('sha256').update(token).digest('hex');
