-- Additive groundwork for GHN post-merger address catalog.
CREATE TYPE "GhnAddressModel" AS ENUM ('LEGACY_3_LEVEL', 'POST_MERGER_2_LEVEL');
CREATE TYPE "GhnLocationSyncRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');
CREATE TYPE "OrderIdempotencyKeyState" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "OrderQuoteStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED');
CREATE TYPE "ShipmentCreationState" AS ENUM ('RESERVED', 'REQUESTING', 'CREATED', 'AMBIGUOUS', 'FAILED');

ALTER TABLE "user_addresses"
  ADD COLUMN "ghn_address_model" "GhnAddressModel" NOT NULL DEFAULT 'LEGACY_3_LEVEL',
  ADD COLUMN "ghn_province_v3_id" TEXT,
  ADD COLUMN "ghn_ward_v3_id" TEXT;

ALTER TABLE "user_addresses"
  ALTER COLUMN "ghn_province_id" DROP NOT NULL,
  ALTER COLUMN "ghn_district_id" DROP NOT NULL,
  ALTER COLUMN "ghn_ward_code" DROP NOT NULL,
  ALTER COLUMN "district_name" DROP NOT NULL;

ALTER TABLE "ghn_locations"
  ADD COLUMN "address_model" "GhnAddressModel" NOT NULL DEFAULT 'LEGACY_3_LEVEL',
  ADD COLUMN "catalog_generation" BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN "aliases" JSONB,
  ADD COLUMN "provider_status" INTEGER,
  ADD COLUMN "last_seen_sync_id" UUID;

ALTER TABLE "orders"
  ADD COLUMN "pickup_setting_version_id" UUID;

ALTER TABLE "order_idempotency_keys"
  ADD COLUMN "state" "OrderIdempotencyKeyState" NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN "request_fingerprint" TEXT,
  ADD COLUMN "quote_id" UUID,
  ADD COLUMN "expires_at" TIMESTAMP(3);

ALTER TABLE "shipments"
  ADD COLUMN "creation_state" "ShipmentCreationState" NOT NULL DEFAULT 'CREATED',
  ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "client_order_code" TEXT,
  ADD COLUMN "pickup_setting_version_id" UUID,
  ADD COLUMN "reconcile_started_at" TIMESTAMP(3),
  ADD COLUMN "reconciled_at" TIMESTAMP(3),
  ADD COLUMN "reconcile_result" JSONB,
  ADD COLUMN "blocks_replacement" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "replacement_authorized_at" TIMESTAMP(3),
  ADD COLUMN "replacement_authorized_by" UUID;

CREATE TABLE "ghn_catalog_metadata" (
  "address_model" "GhnAddressModel" NOT NULL,
  "published_generation" BIGINT NOT NULL,
  "catalog_revision" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ghn_catalog_metadata_pkey" PRIMARY KEY ("address_model")
);

CREATE TABLE "ghn_catalog_publications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "address_model" "GhnAddressModel" NOT NULL,
  "catalog_revision" BIGINT NOT NULL,
  "catalog_generation" BIGINT NOT NULL,
  "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retained_until" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ghn_catalog_publications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ghn_location_sync_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "address_model" "GhnAddressModel" NOT NULL,
  "catalog_generation" BIGINT NOT NULL,
  "fencing_token" BIGINT,
  "status" "GhnLocationSyncRunStatus" NOT NULL DEFAULT 'RUNNING',
  "expected_counts" JSONB,
  "fetched_counts" JSONB,
  "error_summary" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "ghn_location_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_quotes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "token_hash" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "capability_version" TEXT,
  "policy_version" TEXT,
  "catalog_revision" BIGINT,
  "pickup_setting_version_id" UUID,
  "pricing" JSONB NOT NULL,
  "provider_facts" JSONB,
  "status" "OrderQuoteStatus" NOT NULL DEFAULT 'ACTIVE',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_order_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_quotes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ghn_locations" DROP CONSTRAINT IF EXISTS "ghn_locations_level_code_key";
CREATE UNIQUE INDEX "ghn_locations_catalog_generation_address_model_level_code_key" ON "ghn_locations"("catalog_generation", "address_model", "level", "code");
CREATE INDEX "ghn_locations_address_model_catalog_generation_level_parent_code_is_active_idx" ON "ghn_locations"("address_model", "catalog_generation", "level", "parent_code", "is_active");

CREATE UNIQUE INDEX "ghn_catalog_publications_address_model_catalog_revision_key" ON "ghn_catalog_publications"("address_model", "catalog_revision");
CREATE UNIQUE INDEX "ghn_catalog_publications_address_model_catalog_generation_key" ON "ghn_catalog_publications"("address_model", "catalog_generation");
CREATE INDEX "ghn_catalog_publications_retained_until_idx" ON "ghn_catalog_publications"("retained_until");
CREATE UNIQUE INDEX "ghn_location_sync_runs_address_model_catalog_generation_key" ON "ghn_location_sync_runs"("address_model", "catalog_generation");
CREATE INDEX "ghn_location_sync_runs_address_model_status_started_at_idx" ON "ghn_location_sync_runs"("address_model", "status", "started_at");
CREATE UNIQUE INDEX "order_quotes_token_hash_key" ON "order_quotes"("token_hash");
CREATE INDEX "order_quotes_user_id_status_expires_at_idx" ON "order_quotes"("user_id", "status", "expires_at");
CREATE INDEX "order_quotes_expires_at_idx" ON "order_quotes"("expires_at");
CREATE UNIQUE INDEX "shipments_order_id_attempt_number_key" ON "shipments"("order_id", "attempt_number");
CREATE UNIQUE INDEX "shipments_provider_client_order_code_key" ON "shipments"("provider", "client_order_code");
CREATE UNIQUE INDEX "shipments_order_id_blocks_replacement_key" ON "shipments"("order_id") WHERE "blocks_replacement" = true;

ALTER TABLE "order_idempotency_keys" ADD CONSTRAINT "order_idempotency_keys_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "order_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_quotes" ADD CONSTRAINT "order_quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_quotes" ADD CONSTRAINT "order_quotes_consumed_order_id_fkey" FOREIGN KEY ("consumed_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ghn_catalog_metadata" ("address_model", "published_generation", "catalog_revision", "updated_at")
VALUES ('LEGACY_3_LEVEL', 1, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("address_model") DO NOTHING;

INSERT INTO "ghn_catalog_publications" ("address_model", "catalog_revision", "catalog_generation", "retained_until")
VALUES ('LEGACY_3_LEVEL', 1, 1, CURRENT_TIMESTAMP + INTERVAL '365 days')
ON CONFLICT ("address_model", "catalog_revision") DO NOTHING;

ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_ghn_address_model_check" CHECK (
  ("ghn_address_model" = 'LEGACY_3_LEVEL' AND "ghn_province_id" IS NOT NULL AND "ghn_district_id" IS NOT NULL AND "ghn_ward_code" IS NOT NULL AND "district_name" IS NOT NULL AND "ghn_province_v3_id" IS NULL AND "ghn_ward_v3_id" IS NULL)
  OR
  ("ghn_address_model" = 'POST_MERGER_2_LEVEL' AND "ghn_province_v3_id" IS NOT NULL AND "ghn_ward_v3_id" IS NOT NULL AND "ghn_province_id" IS NULL AND "ghn_district_id" IS NULL AND "ghn_ward_code" IS NULL AND "district_name" IS NULL)
) NOT VALID;
