-- Residual cleanup after the main V2 -> V3 migration:
-- 1. addressLine had been set to an old ward name for a few An Phú orders.
-- 2. GHN webhook payloads still contain raw legacy to_ward_code/to_address.

UPDATE "orders" o
SET
  "shipping_info" = jsonb_set(o."shipping_info", '{addressLine}', '""'::jsonb)
    || jsonb_build_object(
      'address', concat_ws(', ', NULLIF(o."shipping_info"->>'wardName', ''), NULLIF(o."shipping_info"->>'provinceName', ''))
    ),
  "shipping_address_snapshot" = CASE
    WHEN o."shipping_address_snapshot" IS NULL THEN NULL
    ELSE jsonb_set(o."shipping_address_snapshot", '{addressLine}', '""'::jsonb)
      || jsonb_build_object(
        'address', concat_ws(', ', NULLIF(o."shipping_address_snapshot"->>'wardName', ''), NULLIF(o."shipping_address_snapshot"->>'provinceName', ''))
      )
  END
WHERE o."shipping_info"->>'addressLine' IN ('Thị trấn An Phú', 'Phường Linh Chiểu', 'Phường 4', 'Xã Thái Niên');

CREATE TEMP TABLE "ghn_v3_mapping" (
  old_code text PRIMARY KEY,
  old_ward_name text NOT NULL,
  old_district_name text NOT NULL,
  old_province_name text NOT NULL,
  ward_code text NOT NULL,
  ward_name text NOT NULL,
  province_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO "ghn_v3_mapping" VALUES
  ('90751', 'Phường Long Bình', 'Thành Phố Thủ Đức', 'Hồ Chí Minh', '1003575', 'Phường Long Bình', 'Hồ Chí Minh'),
  ('21805', 'Phường Linh Chiểu', 'Quận Thủ Đức', 'Hồ Chí Minh', '1003580', 'Phường Thủ Đức', 'Hồ Chí Minh'),
  ('510301', 'Thị trấn An Phú', 'Huyện An Phú', 'An Giang', '1006509', 'Xã An Phú', 'An Giang'),
  ('21303', 'Phường 4', 'Quận Gò Vấp', 'Hồ Chí Minh', '1003553', 'Phường Gò Vấp', 'Hồ Chí Minh'),
  ('80412', 'Xã Thái Niên', 'Huyện Bảo Thắng', 'Lào Cai', '1004828', 'Xã Bảo Thắng', 'Lào Cai'),
  ('20101', 'Phường Bến Nghé', 'Quận 1', 'Hồ Chí Minh', '1003506', 'Phường Sài Gòn', 'Hồ Chí Minh');

WITH converted AS (
  SELECT
    w.id,
    m.ward_code,
    m.ward_name,
    m.province_name,
    COALESCE(
      NULLIF(trim(BOTH ', ' FROM
        regexp_replace(
          regexp_replace(
            regexp_replace(
              COALESCE(w."payload"->'data'->>'to_address', ''),
              ',\s*' || m.old_province_name || '\s*$', '', 'i'
            ),
            ',\s*' || m.old_district_name || '\s*$', '', 'i'
          ),
          ',\s*' || m.old_ward_name || '\s*$', '', 'i'
        )
      ), ''),
      ''
    ) AS address_line
  FROM "webhook_events" w
  JOIN "ghn_v3_mapping" m ON m.old_code = w."payload"->'data'->>'to_ward_code'
)
UPDATE "webhook_events" w
SET "payload" =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        w."payload" #- '{data,to_district_id}',
        '{data,to_ward_code}', to_jsonb(c.ward_code)
      ),
      '{data,to_address}', to_jsonb(concat_ws(', ', NULLIF(c.address_line, ''), c.ward_name, c.province_name))
    ),
    '{data,to_location,wardcode}', to_jsonb(c.ward_code)
  )
FROM converted c
WHERE c.id = w.id;
