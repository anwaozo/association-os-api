-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Rsvp" ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "Rsvp_pkey" PRIMARY KEY ("id");
