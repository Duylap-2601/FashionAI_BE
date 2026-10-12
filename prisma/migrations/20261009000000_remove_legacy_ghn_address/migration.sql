-- Remove GHN legacy 3-level address support. Every user address was converted
-- to POST_MERGER_2_LEVEL before this migration. Historical order snapshots
-- are JSON and stay readable.
ALTER TABLE "user_addresses" DROP CONSTRAINT IF EXISTS "user_addresses_ghn_address_model_check";
ALTER TABLE "user_addresses" DROP COLUMN IF EXISTS "ghn_province_id";
ALTER TABLE "user_addresses" DROP COLUMN IF EXISTS "ghn_district_id";
ALTER TABLE "user_addresses" DROP COLUMN IF EXISTS "ghn_ward_code";
ALTER TABLE "user_addresses" DROP COLUMN IF EXISTS "district_name";
ALTER TABLE "user_addresses" ALTER COLUMN "ghn_address_model" SET DEFAULT 'POST_MERGER_2_LEVEL';

DELETE FROM "ghn_locations" WHERE "address_model" = 'LEGACY_3_LEVEL';
DELETE FROM "ghn_catalog_publications" WHERE "address_model" = 'LEGACY_3_LEVEL';
DELETE FROM "ghn_location_sync_runs" WHERE "address_model" = 'LEGACY_3_LEVEL';
DELETE FROM "ghn_catalog_metadata" WHERE "address_model" = 'LEGACY_3_LEVEL';
