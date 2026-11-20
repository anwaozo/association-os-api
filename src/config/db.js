import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './env.js';

// Build the node-postgres config from DATABASE_URL.
// - Drops Prisma-engine-only params (pgbouncer, connection_limit, ...) that
//   node-postgres doesn't understand.
// - Managed Postgres (Supabase, Neon, RDS) expects TLS; node-postgres does not
//   turn it on by itself. DB_SSL=true|false overrides the auto-detection.
export function pgConfig(url = env.DATABASE_URL) {
   const u = new URL(url);
   for (const p of ['pgbouncer', 'connection_limit', 'pool_timeout', 'schema', 'sslmode', 'sslaccept']) {
      u.searchParams.delete(p);
   }
   const managedHost = /(supabase\.(com|co)|neon\.tech|rds\.amazonaws\.com)$/i.test(u.hostname);
   const sslSetting = (process.env.DB_SSL || 'auto').toLowerCase();
   const useSsl = sslSetting === 'true' || (sslSetting === 'auto' && managedHost);
   return {
      connectionString: u.toString(),
      // Provider certificates are not in Node's default CA list.
      ssl: useSsl ? { rejectUnauthorized: false } : false,
      max: env.DB_POOL_MAX,
      connectionTimeoutMillis: 10000,
   };
}

// One pooled client per process (or per warm serverless instance).
const adapter = new PrismaPg(pgConfig());

const globalForPrisma = globalThis;
export const prisma = globalForPrisma.__aosPrisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== 'production') globalForPrisma.__aosPrisma = prisma;

// ---------------------------------------------------------------------------
// Tenant isolation
//
// `prisma` (above) is the unscoped client. Only auth (login/refresh) and
// platform-admin routes may use it. Everything else uses forTenant(orgId),
// which forces organizationId into every read filter and every write, so a
// controller cannot reach another organization's rows even by ID.
// ---------------------------------------------------------------------------

export const TENANT_MODELS = new Set([
   'User',
   'UserMembershipHistory',
   'Contact',
   'Event',
   'Membership',
   'Rsvp',
   'Campaign',
   'Activity',
   'MessageTemplate',
   'Message',
   'MessageRecipient',
   'Donation',
]);

const WHERE_OPS = new Set([
   'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
   'count', 'aggregate', 'groupBy',
   'update', 'updateMany', 'updateManyAndReturn',
   'delete', 'deleteMany',
]);
const CREATE_OPS = new Set(['create']);
const CREATE_MANY_OPS = new Set(['createMany', 'createManyAndReturn']);

const scopeWhere = (where, organizationId) => ({ ...(where || {}), organizationId });

const scopeData = (data, organizationId) => {
   if (data && data.organizationId !== undefined && data.organizationId !== organizationId) {
      throw new TenantViolationError('Cannot write a record for another organization');
   }
   return { ...data, organizationId };
};

export class TenantViolationError extends Error {
   constructor(message) {
      super(message);
      this.status = 403;
   }
}

const cache = new Map();

export function forTenant(organizationId) {
   const orgId = Number(organizationId);
   if (!Number.isInteger(orgId) || orgId <= 0) {
      throw new TenantViolationError('Missing organization context');
   }
   if (cache.has(orgId)) return cache.get(orgId);

   const scoped = prisma.$extends({
      name: `tenant-${orgId}`,
      query: {
         $allModels: {
            async $allOperations({ model, operation, args, query }) {
               if (!TENANT_MODELS.has(model)) return query(args);
               const a = { ...(args || {}) };

               if (WHERE_OPS.has(operation)) {
                  a.where = scopeWhere(a.where, orgId);
                  if (operation === 'update' || operation === 'updateMany' || operation === 'updateManyAndReturn') {
                     if (a.data && a.data.organizationId !== undefined) {
                        throw new TenantViolationError('organizationId cannot be changed');
                     }
                  }
               } else if (CREATE_OPS.has(operation)) {
                  a.data = scopeData(a.data, orgId);
               } else if (CREATE_MANY_OPS.has(operation)) {
                  const rows = Array.isArray(a.data) ? a.data : [a.data];
                  a.data = rows.map((r) => scopeData(r, orgId));
               } else if (operation === 'upsert') {
                  a.where = scopeWhere(a.where, orgId);
                  a.create = scopeData(a.create, orgId);
                  if (a.update?.organizationId !== undefined) {
                     throw new TenantViolationError('organizationId cannot be changed');
                  }
               } else {
                  // Unknown operation on a tenant model: refuse rather than leak.
                  throw new TenantViolationError(`Operation ${operation} is not allowed on ${model}`);
               }
               return query(a);
            },
         },
      },
   });

   cache.set(orgId, scoped);
   return scoped;
}
