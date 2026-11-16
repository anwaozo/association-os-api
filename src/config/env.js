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
};

if (env.isProd && env.JWT_SECRET.length < 32) {
   throw new Error('JWT_SECRET must be at least 32 characters in production');
}
