// Netlify Functions entry point. The same Express app runs unchanged under
// `node server.js` (Docker, AWS, Mac Studio) — this file is the only
// Netlify-specific code.
import serverless from 'serverless-http';
import app from '../../src/app.js';

export const handler = serverless(app);
