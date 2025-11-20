-- CreateTable
CREATE TABLE "Rsvp" (
    "user_id" INTEGER NOT NULL,
    "event_id" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Rsvp_user_id_event_id_key" ON "Rsvp"("user_id", "event_id");
