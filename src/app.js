import express from 'express';
import dotenv from 'dotenv';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { applySecurityMiddleware } from './middleware/security.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import contactRoutes from './routes/contact.routes.js';
import eventRoutes from './routes/event.routes.js';
import membershipRoutes from './routes/membership.routes.js';
import campaignRoutes from './routes/campaign.routes.js';

dotenv.config();
const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));

applySecurityMiddleware(app);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/memberships', membershipRoutes);
app.use('/api/campaign', campaignRoutes);

app.get('/', (req, res) => res.send('API running securely'));

export default app;
