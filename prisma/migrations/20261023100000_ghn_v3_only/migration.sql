-- GHN is post-merger (V3, 2-level) only. Remove every legacy 3-level artifact:
-- enum values, district rows, stale unpublished catalogs, and order snapshots.

-- 1. Drop legacy user addresses and require V3 location ids.
DELETE FROM "user_addresses"
WHERE "ghn_address_model" = 'LEGACY_3_LEVEL'
   OR "ghn_province_v3_id" IS NULL
   OR "ghn_ward_v3_id" IS NULL;

ALTER TABLE "user_addresses" DROP COLUMN IF EXISTS "ghn_address_model";
ALTER TABLE "user_addresses" ALTER COLUMN "ghn_province_v3_id" SET NOT NULL;
ALTER TABLE "user_addresses" ALTER COLUMN "ghn_ward_v3_id" SET NOT NULL;

-- 2. Remove legacy catalog metadata and any catalog not currently published.
DELETE FROM "ghn_locations" WHERE "level" = 'DISTRICT';
DELETE FROM "ghn_locations" WHERE "address_model" = 'LEGACY_3_LEVEL';
DELETE FROM "ghn_catalog_publications" WHERE "address_model" = 'LEGACY_3_LEVEL';
DELETE FROM "ghn_location_sync_runs" WHERE "address_model" = 'LEGACY_3_LEVEL';
DELETE FROM "ghn_catalog_metadata" WHERE "address_model" = 'LEGACY_3_LEVEL';

DELETE FROM "ghn_locations"
WHERE "address_model" = 'POST_MERGER_2_LEVEL'
  AND EXISTS (
    SELECT 1 FROM "ghn_catalog_metadata"
    WHERE "address_model" = 'POST_MERGER_2_LEVEL'
  )
  AND "catalog_generation" <> (
    SELECT "published_generation" FROM "ghn_catalog_metadata"
    WHERE "address_model" = 'POST_MERGER_2_LEVEL'
  );

-- 3. Convert order address snapshots from GHN legacy ward codes to V3.
CREATE TEMP TABLE "ghn_v3_mapping" (
  old_code text PRIMARY KEY,
  old_ward_name text NOT NULL,
  old_district_name text NOT NULL,
  old_province_name text NOT NULL,
  ward_code text NOT NULL,
  ward_name text NOT NULL,
  province_code text NOT NULL,
  province_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO "ghn_v3_mapping" VALUES
  ('90751', 'Phường Long Bình', 'Thành Phố Thủ Đức', 'Hồ Chí Minh', '1003575', 'Phường Long Bình', '1000001', 'Hồ Chí Minh'),
  ('21805', 'Phường Linh Chiểu', 'Quận Thủ Đức', 'Hồ Chí Minh', '1003580', 'Phường Thủ Đức', '1000001', 'Hồ Chí Minh'),
  ('510301', 'Thị trấn An Phú', 'Huyện An Phú', 'An Giang', '1006509', 'Xã An Phú', '1000013', 'An Giang'),
  ('21303', 'Phường 4', 'Quận Gò Vấp', 'Hồ Chí Minh', '1003553', 'Phường Gò Vấp', '1000001', 'Hồ Chí Minh'),
  ('80412', 'Xã Thái Niên', 'Huyện Bảo Thắng', 'Lào Cai', '1004828', 'Xã Bảo Thắng', '1000024', 'Lào Cai'),
  ('20101', 'Phường Bến Nghé', 'Quận 1', 'Hồ Chí Minh', '1003506', 'Phường Sài Gòn', '1000001', 'Hồ Chí Minh');

WITH converted AS (
  SELECT
    o.id,
    m.ward_code,
    m.ward_name,
    m.province_code,
    m.province_name,
    COALESCE(
      NULLIF(trim(o."shipping_info"->>'addressLine'), ''),
      NULLIF(trim(BOTH ', ' FROM
        regexp_replace(
          regexp_replace(
            regexp_replace(
              COALESCE(o."shipping_info"->>'address', ''),
              ',\s*' || m.old_province_name || '\s*$', '', 'i'
            ),
            ',\s*' || m.old_district_name || '\s*$', '', 'i'
          ),
          ',\s*' || m.old_ward_name || '\s*$', '', 'i'
        )
      ), '')
    ) AS address_line
  FROM "orders" o
  JOIN "ghn_v3_mapping" m ON m.old_code = o."shipping_info"->>'ghnWardCode'
  WHERE (o."shipping_info" ? 'ghnWardCode' OR o."shipping_info" ? 'ghnDistrictId')
)
UPDATE "orders" o
SET "shipping_info" =
  (o."shipping_info" - 'ghnProvinceId' - 'ghnDistrictId' - 'ghnWardCode' - 'districtName')
  || jsonb_build_object(
    'ghnAddressModel', 'POST_MERGER_2_LEVEL',
    'ghnProvinceV3Id', c.province_code,
    'ghnWardV3Id', c.ward_code,
    'provinceName', c.province_name,
    'wardName', c.ward_name,
    'addressLine', c.address_line,
    'address', concat_ws(', ', NULLIF(c.address_line, ''), c.ward_name, c.province_name)
  )
FROM converted c
WHERE c.id = o.id;

WITH converted AS (
  SELECT
    o.id,
    m.ward_code,
    m.ward_name,
    m.province_code,
    m.province_name,
    COALESCE(
      NULLIF(trim(o."shipping_address_snapshot"->>'addressLine'), ''),
      NULLIF(trim(BOTH ', ' FROM
        regexp_replace(
          regexp_replace(
            regexp_replace(
              COALESCE(o."shipping_address_snapshot"->>'address', ''),
              ',\s*' || m.old_province_name || '\s*$', '', 'i'
            ),
            ',\s*' || m.old_district_name || '\s*$', '', 'i'
          ),
          ',\s*' || m.old_ward_name || '\s*$', '', 'i'
        )
      ), '')
    ) AS address_line
  FROM "orders" o
  JOIN "ghn_v3_mapping" m ON m.old_code = o."shipping_address_snapshot"->>'ghnWardCode'
  WHERE (o."shipping_address_snapshot" ? 'ghnWardCode' OR o."shipping_address_snapshot" ? 'ghnDistrictId')
)
UPDATE "orders" o
SET "shipping_address_snapshot" =
  (o."shipping_address_snapshot" - 'ghnProvinceId' - 'ghnDistrictId' - 'ghnWardCode' - 'districtName')
  || jsonb_build_object(
    'ghnAddressModel', 'POST_MERGER_2_LEVEL',
    'ghnProvinceV3Id', c.province_code,
    'ghnWardV3Id', c.ward_code,
    'provinceName', c.province_name,
    'wardName', c.ward_name,
    'addressLine', c.address_line,
    'address', concat_ws(', ', NULLIF(c.address_line, ''), c.ward_name, c.province_name)
  )
FROM converted c
WHERE c.id = o.id;

-- 4. Replace the enums so Prisma no longer accepts legacy values.
ALTER TABLE "ghn_locations" ALTER COLUMN "address_model" DROP DEFAULT;

ALTER TYPE "GhnAddressModel" RENAME TO "GhnAddressModel_old";
CREATE TYPE "GhnAddressModel" AS ENUM ('POST_MERGER_2_LEVEL');

ALTER TABLE "ghn_locations"
  ALTER COLUMN "address_model" TYPE "GhnAddressModel"
  USING ('POST_MERGER_2_LEVEL'::"GhnAddressModel");
ALTER TABLE "ghn_catalog_metadata"
  ALTER COLUMN "address_model" TYPE "GhnAddressModel"
  USING ('POST_MERGER_2_LEVEL'::"GhnAddressModel");
ALTER TABLE "ghn_catalog_publications"
  ALTER COLUMN "address_model" TYPE "GhnAddressModel"
  USING ('POST_MERGER_2_LEVEL'::"GhnAddressModel");
ALTER TABLE "ghn_location_sync_runs"
  ALTER COLUMN "address_model" TYPE "GhnAddressModel"
  USING ('POST_MERGER_2_LEVEL'::"GhnAddressModel");

ALTER TABLE "ghn_locations"
  ALTER COLUMN "address_model" SET DEFAULT 'POST_MERGER_2_LEVEL';

DROP TYPE "GhnAddressModel_old";

ALTER TYPE "GhnLocationLevel" RENAME TO "GhnLocationLevel_old";
CREATE TYPE "GhnLocationLevel" AS ENUM ('PROVINCE', 'WARD');

ALTER TABLE "ghn_locations"
  ALTER COLUMN "level" TYPE "GhnLocationLevel"
  USING ("level"::text::"GhnLocationLevel");

DROP TYPE "GhnLocationLevel_old";
