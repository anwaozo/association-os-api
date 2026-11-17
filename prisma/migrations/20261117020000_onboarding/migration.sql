-- Onboarding: organization applications, approval, and single-use admin invites.

ALTER TABLE "Organization" ADD COLUMN "contactName" TEXT;
ALTER TABLE "Organization" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "Organization" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "Organization" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "Organization" ADD COLUMN "onboardedAt" TIMESTAMP(3);

-- Existing organizations are already set up.
UPDATE "Organization" SET "onboardedAt" = "createdAt", "approvedAt" = "createdAt" WHERE "status" = 1;

CREATE TABLE "Invite" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" INTEGER NOT NULL DEFAULT 1,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");
CREATE INDEX "Invite_organizationId_idx" ON "Invite"("organizationId");

ALTER TABLE "Invite" ADD CONSTRAINT "Invite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
