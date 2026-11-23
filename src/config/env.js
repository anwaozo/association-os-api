import dotenv from 'dotenv';
dotenv.config();

const required = (name) => {
   const v = process.env[name];
   if (!v) throw new Error(`Missing required environment variable ${name}`);
   return v;
};

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const env = {
   NODE_ENV: process.env.NODE_ENV || 'development',
   isProd: process.env.NODE_ENV === 'production',
   PORT: Number(process.env.PORT || 4000),
   DATABASE_URL: required('DATABASE_URL'),
   JWT_SECRET: required('JWT_SECRET'),
   // Comma-separated list of allowed browser origins, e.g.
   // https://app.associationos.com,https://associationos.netlify.app
   CORS_ORIGINS: list(process.env.CORS_ORIGINS || 'http://localhost:3000'),
   // Serverless: keep this small (Supabase pooler does the real pooling).
   DB_POOL_MAX: Number(process.env.DB_POOL_MAX || (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME ? 1 : 10)),
   RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX || 300),
   // The web app's public URL, used in Stripe return links. Defaults to the
   // first non-wildcard CORS origin.
   APP_URL: (process.env.APP_URL || list(process.env.CORS_ORIGINS || 'http://localhost:3000').find((o) => !o.includes('*')) || 'http://localhost:3000').replace(/\/$/, ''),
   // Email (Mailgun). Sending stays off until key, domain and from are set.
   MAILGUN_API_KEY: (process.env.MAILGUN_API_KEY || '').trim(),
   MAILGUN_DOMAIN: (process.env.MAILGUN_DOMAIN || '').trim(),
   // US region by default; EU accounts use https://api.eu.mailgun.net
   MAILGUN_API_BASE: (process.env.MAILGUN_API_BASE || 'https://api.mailgun.net').trim(),
   MAILGUN_WEBHOOK_SIGNING_KEY: (process.env.MAILGUN_WEBHOOK_SIGNING_KEY || '').trim(),
   EMAIL_FROM: (process.env.EMAIL_FROM || '').trim(),
   // Stripe Connect. Online donations stay off until the secret key is set.
   STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
   STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
   STRIPE_CONNECT_WEBHOOK_SECRET: process.env.STRIPE_CONNECT_WEBHOOK_SECRET || '',
};

if (env.isProd && env.JWT_SECRET.length < 32) {
   throw new Error('JWT_SECRET must be at least 32 characters in production');
}
