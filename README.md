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

## Directory, Notifications, Messages, Fundraising

### Directory profiles
Members fill in title, company, location, website, LinkedIn, about and up to 10 areas of
expertise under **Settings > My Profile** (`PUT /api/users/me`). `showInDirectory: false`
hides a member from other members; admins still see everyone.

### Notifications (activity feed)
Actions write a row to `Activity` (member added, people imported, event created, RSVP,
tier change, campaign created, donation, message sent).

| Method | Path | Who |
|---|---|---|
| GET | `/api/notifications?type=a,b&before=<id>` | org admin, 50 per page |
| GET | `/api/notifications/unread-count` | org admin |
| POST | `/api/notifications/seen` | org admin |

### Messages (email through Resend)
Each organization gets five editable default templates. Audiences: `all_members`,
`members_and_contacts`, `tier` (`{ tierId }`), `event_attendees` (`{ eventId }`),
`custom` (`{ userIds }`). Merge fields: `{{first_name}}`, `{{name}}`, `{{email}}`, `{{organization}}`.

Until `RESEND_API_KEY` and `EMAIL_FROM` are set, "send" saves a message as `ready`; once email
is on, admins send ready messages with one click. Messages go out in batches of 100 from
`"<Org name>" <EMAIL_FROM>` with reply-to set to the org's contact email.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/messages/config` | `{ emailEnabled }` |
| GET/POST/PUT/DELETE | `/api/messages/templates[/:id]` | |
| POST | `/api/messages/audience-preview` | `{ audienceType, audienceRef }` → `{ label, count }` |
| GET/POST | `/api/messages` | POST body adds `action: "send" \| "draft"` |
| GET/PUT/DELETE | `/api/messages/:id` | edit/delete only drafts and ready messages |
| POST | `/api/messages/:id/send` | |
| POST | `/api/messages/webhook/resend` | Resend webhook (Svix-signed, no login) |

**Turning email on:** create a Resend account, verify the sending domain (add its DNS records),
then set `RESEND_API_KEY` and `EMAIL_FROM` on the API site and redeploy. For delivery tracking,
add a Resend webhook to `https://<api-site>/api/messages/webhook/resend` for `email.delivered`,
`email.opened`, `email.clicked`, `email.bounced` and `email.complained`, then set `RESEND_WEBHOOK_SECRET`.

### Fundraising (Stripe Connect, Express accounts)
Each organization connects its own Stripe Express account from **Settings > Payments**.
Online gifts use Stripe Checkout as *destination charges*, so funds land in the organization's
account. `Organization.platformFeePercent` (default 0) adds an application fee for Apperr;
a platform admin sets it with `PUT /api/platform/organizations/:id/fee`.
Admins can also record cash, check and other offline gifts.

| Method | Path | Who |
|---|---|---|
| GET | `/api/payments/status` | org admin |
| POST | `/api/payments/connect` | org admin → `{ url }` (Stripe onboarding) |
| POST | `/api/payments/dashboard` | org admin → `{ url }` (Express dashboard) |
| GET | `/api/donations/availability` | logged in → `{ acceptingDonations }` |
| POST | `/api/donations/checkout` | logged in: `{ amount, campaignId?, isAnonymous?, note? }` → `{ url }` |
| GET | `/api/donations/mine` | logged in |
| GET | `/api/donations`, `/api/donations/summary` | org admin |
| POST / DELETE | `/api/donations[/:id]` | org admin: record / delete offline gifts |
| GET | `/api/public/:orgSlug/campaigns/:slug` | anyone (public campaigns only) |
| POST | `/api/public/:orgSlug/campaigns/:slug/checkout` | anyone: adds `donorName`, `donorEmail` |
| POST | `/api/payments/webhook` | Stripe webhook (signed, no login) |

`GET /api/campaign` now includes `raisedCents` and `donationCount` for each campaign.
The public donation page is `https://<web-app>/give/<org-slug>/<campaign-slug>` (campaigns marked public).

**Turning on online giving (test mode first):**
1. In the Stripe dashboard (Apperr's platform account), enable **Connect** and choose Express.
2. Set `STRIPE_SECRET_KEY` (`sk_test_...`) and `APP_URL` on the API site.
3. Add a webhook endpoint `https://<api-site>/api/payments/webhook` for *your account* events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired` and `charge.refunded`.
   Set its signing secret as `STRIPE_WEBHOOK_SECRET`.
4. Add a second endpoint (same URL) for *connected accounts* events `account.updated`.
   Set its signing secret as `STRIPE_CONNECT_WEBHOOK_SECRET`.
5. Redeploy, open Settings > Payments as an org admin and connect.

Recurring (monthly) donations are not in this release; campaigns marked recurring take one-time gifts.
