import express from 'express';
import { authMiddleware, requireAdmin, requirePlatformAdmin } from '../middleware/auth.js';
import {
   getCurrent, updateCurrent, getPublicBySlug,
   listOrganizations, createOrganization, setOrganizationStatus,
   approveOrganization, rejectOrganization, regenerateInvite,
} from '../controllers/organization.controller.js';
import { completeOnboarding } from '../controllers/onboarding.controller.js';

export const organizationRoutes = express.Router();
organizationRoutes.get('/current', authMiddleware, getCurrent);
organizationRoutes.put('/current', authMiddleware, requireAdmin, updateCurrent);
organizationRoutes.post('/current/onboarding-complete', authMiddleware, requireAdmin, completeOnboarding);
organizationRoutes.get('/public/:slug', getPublicBySlug);

export const platformRoutes = express.Router();
platformRoutes.use(authMiddleware, requirePlatformAdmin);
platformRoutes.get('/organizations', listOrganizations);
platformRoutes.post('/organizations', createOrganization);
platformRoutes.put('/organizations/:id/status', setOrganizationStatus);
platformRoutes.post('/organizations/:id/approve', approveOrganization);
platformRoutes.post('/organizations/:id/reject', rejectOrganization);
platformRoutes.post('/organizations/:id/invites', regenerateInvite);
