-- MoMo migration support: pending payment attempts and explicit webhook lifecycle.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3);

ALTER TABLE "webhook_events" ALTER COLUMN "processed_at" DROP DEFAULT;

CREATE INDEX IF NOT EXISTS "payments_provider_status_created_at_idx" ON "payments"("provider", "status", "created_at");
CREATE INDEX IF NOT EXISTS "payments_expires_at_idx" ON "payments"("expires_at");
