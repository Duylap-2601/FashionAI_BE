-- GHN webhook payloads are stored raw. Replace the remaining legacy ward codes
-- and drop V2-only/district keys so no V2 address values survive.
-- 90737 (Linh Trung) -> 1003574 (Phường Linh Xuân)
-- 90752 (Long Thạnh Mỹ) -> 1003575 (Phường Long Bình)

WITH cleaned AS (
  SELECT
    w.id,
    (
      SELECT jsonb_object_agg(
        key,
        CASE key
          WHEN 'from_ward_code' THEN to_jsonb(
            CASE value #>> '{}'
              WHEN '90737' THEN '1003574'
              WHEN '90752' THEN '1003575'
              ELSE value #>> '{}'
            END
          )
          WHEN 'return_ward_code' THEN to_jsonb(
            CASE value #>> '{}'
              WHEN '90737' THEN '1003574'
              WHEN '90752' THEN '1003575'
              ELSE value #>> '{}'
            END
          )
          ELSE value
        END
      )
      FROM jsonb_each(w."payload"->'data')
      WHERE key !~ '_v2$'
        AND key NOT LIKE '%district_id'
    ) AS data
  FROM "webhook_events" w
  WHERE w."payload" ? 'data'
)
UPDATE "webhook_events" w
SET "payload" =
  jsonb_set(
    jsonb_set(
      jsonb_set(w."payload", '{data}', c.data),
      '{data,from_location,wardcode}',
      to_jsonb(CASE w."payload"->'data'->'from_location'->>'wardcode'
        WHEN '90737' THEN '1003574'
        WHEN '90752' THEN '1003575'
        ELSE w."payload"->'data'->'from_location'->>'wardcode'
      END)
    ),
    '{data,return_location,wardcode}',
    to_jsonb(CASE w."payload"->'data'->'return_location'->>'wardcode'
      WHEN '90737' THEN '1003574'
      WHEN '90752' THEN '1003575'
      ELSE w."payload"->'data'->'return_location'->>'wardcode'
    END)
  )
FROM cleaned c
WHERE c.id = w.id;
