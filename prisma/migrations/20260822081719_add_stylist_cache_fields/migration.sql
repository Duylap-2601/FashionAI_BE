-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "provider" SET DEFAULT 'SEPAY';

-- AlterTable
ALTER TABLE "stylist_results" ADD COLUMN     "cache_key" TEXT,
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "human_image_hash" TEXT;

-- CreateIndex
CREATE INDEX "stylist_results_human_image_hash_idx" ON "stylist_results"("human_image_hash");

-- CreateIndex
CREATE INDEX "stylist_results_cache_key_idx" ON "stylist_results"("cache_key");

-- CreateIndex
CREATE INDEX "stylist_results_expires_at_idx" ON "stylist_results"("expires_at");
