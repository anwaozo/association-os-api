import express from 'express';
import { authMiddleware, requireAdmin, requirePlatformAdmin } from '../middleware/auth.js';
import {
   getCurrent, updateCurrent, getPublicBySlug,
   listOrganizations, createOrganization, setOrganizationStatus,
} from '../controllers/organization.controller.js';

export const organizationRoutes = express.Router();
organizationRoutes.get('/current', authMiddleware, getCurrent);
organizationRoutes.put('/current', authMiddleware, requireAdmin, updateCurrent);
organizationRoutes.get('/public/:slug', getPublicBySlug);

export const platformRoutes = express.Router();
platformRoutes.use(authMiddleware, requirePlatformAdmin);
platformRoutes.get('/organizations', listOrganizations);
platformRoutes.post('/organizations', createOrganization);
platformRoutes.put('/organizations/:id/status', setOrganizationStatus);
