-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'SCHEDULED';

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "auto_renew" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "renewal_reminder_sent_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "subscriptions_status_expires_at_idx" ON "subscriptions"("status", "expires_at");

-- CreateIndex
CREATE INDEX "subscriptions_status_starts_at_idx" ON "subscriptions"("status", "starts_at");
