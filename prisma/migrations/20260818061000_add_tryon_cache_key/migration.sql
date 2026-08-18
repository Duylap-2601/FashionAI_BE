-- Cache key tuong minh cho ket qua thu do + thoi diem het han cache theo SRS.
ALTER TABLE "try_on_results" ADD COLUMN "cache_key" TEXT;
ALTER TABLE "try_on_results" ADD COLUMN "expires_at" TIMESTAMP(3);

-- Backfill cache_key cho du lieu cu: userId:humanHash:garmentHash:category
UPDATE "try_on_results"
SET "cache_key" = "user_id" || ':' || "human_image_hash" || ':' || "garment_image_hash" || ':' || "category"
WHERE "cache_key" IS NULL;

CREATE INDEX "try_on_results_cache_key_idx" ON "try_on_results"("cache_key");
CREATE INDEX "try_on_results_expires_at_idx" ON "try_on_results"("expires_at");
