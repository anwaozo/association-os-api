-- Multi-tenancy: add Organization and stamp organizationId on every tenant-owned row.
-- Existing data (single-tenant, The Friar Society) becomes organization #1.

-- CreateTable
CREATE TABLE "Organization" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tagline" TEXT,
    "logoUrl" TEXT,
    "primaryColor" TEXT DEFAULT '#1F3864',
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- Existing single-tenant data moves into its own organization (only if there is data).
INSERT INTO "Organization" ("name", "slug", "tagline")
SELECT 'The Friar Society', 'friar-society', 'UT Austin''s oldest honor society'
WHERE EXISTS (SELECT 1 FROM "User");

-- Add columns as nullable first, backfill, then enforce NOT NULL.
ALTER TABLE "User"                  ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "User"                  ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserMembershipHistory" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "Contact"               ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "Event"                 ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "Membership"            ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "Rsvp"                  ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "Campaign"              ADD COLUMN "organizationId" INTEGER;

UPDATE "User"                  SET "organizationId" = (SELECT "id" FROM "Organization" WHERE "slug" = 'friar-society');
UPDATE "UserMembershipHistory" SET "organizationId" = (SELECT "id" FROM "Organization" WHERE "slug" = 'friar-society');
UPDATE "Contact"               SET "organizationId" = (SELECT "id" FROM "Organization" WHERE "slug" = 'friar-society');
UPDATE "Event"                 SET "organizationId" = (SELECT "id" FROM "Organization" WHERE "slug" = 'friar-society');
UPDATE "Membership"            SET "organizationId" = (SELECT "id" FROM "Organization" WHERE "slug" = 'friar-society');
UPDATE "Rsvp"                  SET "organizationId" = (SELECT "id" FROM "Organization" WHERE "slug" = 'friar-society');
UPDATE "Campaign"              SET "organizationId" = (SELECT "id" FROM "Organization" WHERE "slug" = 'friar-society');

ALTER TABLE "User"                  ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "UserMembershipHistory" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Contact"               ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Event"                 ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Membership"            ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Rsvp"                  ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Campaign"              ALTER COLUMN "organizationId" SET NOT NULL;

-- The existing Super Admin becomes a platform admin so Apperr can create new organizations.
UPDATE "User" SET "isPlatformAdmin" = true WHERE "email" = 'admin@mail.com';

-- Uniqueness becomes per organization.
DROP INDEX "User_phone_key";
DROP INDEX "Event_slug_key";
DROP INDEX "Membership_slug_key";
DROP INDEX "Campaign_slug_key";

CREATE UNIQUE INDEX "User_organizationId_phone_key"      ON "User"("organizationId", "phone");
CREATE UNIQUE INDEX "Event_organizationId_slug_key"      ON "Event"("organizationId", "slug");
CREATE UNIQUE INDEX "Membership_organizationId_slug_key" ON "Membership"("organizationId", "slug");
CREATE UNIQUE INDEX "Campaign_organizationId_slug_key"   ON "Campaign"("organizationId", "slug");

CREATE INDEX "User_organizationId_idx"                  ON "User"("organizationId");
CREATE INDEX "UserMembershipHistory_organizationId_idx" ON "UserMembershipHistory"("organizationId");
CREATE INDEX "Contact_organizationId_idx"               ON "Contact"("organizationId");
CREATE INDEX "Event_organizationId_date_idx"            ON "Event"("organizationId", "date");
CREATE INDEX "Rsvp_organizationId_idx"                  ON "Rsvp"("organizationId");
CREATE INDEX "Campaign_organizationId_idx"              ON "Campaign"("organizationId");

-- Foreign keys
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserMembershipHistory" ADD CONSTRAINT "UserMembershipHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Rsvp" ADD CONSTRAINT "Rsvp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
