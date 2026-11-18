# AssociationOS API

Multi-tenant API for AssociationOS (chambers of commerce, associations, nonprofits).
Node 22, Express 5, Prisma 6 (Rust-free client + `pg` adapter), PostgreSQL (Supabase).

## How tenancy works

- `Organization` is the tenant. Every tenant-owned table (`User`, `Contact`, `Event`,
  `Membership`, `UserMembershipHistory`, `Rsvp`, `Campaign`) has `organizationId`.
- Login puts `organizationId` in the signed access token. The API never takes it from the request body.
- `authMiddleware` attaches `req.db = forTenant(orgId)`: a Prisma client that adds
  `organizationId` to every read filter and every write (`src/config/db.js`). An ID from
  another organization behaves as if it doesn't exist (404).
- The unscoped `prisma` client is only used for login/refresh, organization branding, and
  platform-admin routes.
- Slugs (events, tiers, campaigns) and phone numbers are unique per organization.
  Email is unique platform-wide, so login needs no organization picker.

Roles: `1` admin, `2` member, `3` contact. `isPlatformAdmin` marks Apperr staff who can create organizations.

## Run locally

```bash
cp .env.example .env            # point DATABASE_URL and DIRECT_URL at a Postgres database
npm install
npx prisma migrate deploy
npm run db:seed                 # platform admin + two demo organizations
npm run dev                     # http://localhost:4000/api/health
npm test                        # tenant isolation + permission tests (needs the seeded DB)
```

Or with Docker: `docker compose up`, then run migrations and the seed inside the `api` container.

### Demo accounts (from `npm run db:seed`)

All use the password in `SEED_PASSWORD` (default `Demo@2026!`).

| Account | Role |
|---|---|
| admin@associationos.app | Platform admin |
| admin@bayoucitychamber.org | Admin, Bayou City Business Chamber |
| monique@bayoucitychamber.org | Member, Bayou City Business Chamber |
| admin@lonestarpros.org | Admin, Lone Star Professionals Association |
| evelyn@lonestarpros.org | Member, Lone Star Professionals Association |

Change `SEED_PASSWORD` before seeding any database that is reachable from the internet.

### Lost the platform admin password?

On the API site in Netlify set `SEED_ON_DEPLOY=true`, `SEED_RESET_ADMIN_PASSWORD=true` and a new
`SEED_PASSWORD`, then redeploy. The build resets the platform admin's password to `SEED_PASSWORD`
and signs out its old sessions. Set `SEED_RESET_ADMIN_PASSWORD` back to `false` afterwards.

## Deploy

### Netlify (current)

1. New Netlify site from this repo. `netlify.toml` already sets the build
   (`prisma generate && prisma migrate deploy`), the function, and the `/api/*` redirect.
2. Environment variables: `DATABASE_URL` (Supabase transaction pooler, port 6543),
   `DIRECT_URL` (Supabase direct/session, port 5432), `JWT_SECRET`, `CORS_ORIGINS`
   (the frontend's URL), `NODE_ENV=production`.
3. Deploy, then check `https://<site>/api/health`.

### AWS or the Mac Studio servers (later)

Same code, no changes: `docker build -t associationos-api .` and run with the same env vars.
Run `npx prisma migrate deploy` as a release step.

## Endpoints added for tenancy

| Method | Path | Who |
|---|---|---|
| GET | `/api/health` | anyone |
| GET | `/api/organizations/current` | logged in |
| PUT | `/api/organizations/current` | org admin (name, tagline, logoUrl, primaryColor) |
| GET | `/api/organizations/public/:slug` | anyone (branding for a per-org login page) |
| GET | `/api/platform/organizations` | platform admin |
| POST | `/api/platform/organizations` | platform admin: `{ name, slug?, tagline?, logoUrl?, primaryColor?, admin: { name, email, phone, password } }` |
| PUT | `/api/platform/organizations/:id/status` | platform admin: `{ status: 0 \| 1 }` |

`/api/auth/register`, `/api/auth/register/:id` and `/api/auth/bulk_register` now require an org admin.

## Migrating the existing database

`prisma/migrations/20261116190000_multi_tenancy` moves all existing data into an organization
called "The Friar Society" (slug `friar-society`) and makes `admin@mail.com` a platform admin.
Back up the database before running `prisma migrate deploy` against it.
