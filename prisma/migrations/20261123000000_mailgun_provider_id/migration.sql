-- Mailgun returns one message id per batch, shared by every recipient in it,
-- so providerId is no longer unique. Webhooks match on (providerId, email).
DROP INDEX "MessageRecipient_providerId_key";
CREATE INDEX "MessageRecipient_providerId_idx" ON "MessageRecipient"("providerId");
