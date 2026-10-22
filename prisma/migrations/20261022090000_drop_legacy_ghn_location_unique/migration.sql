-- Migration 20261008090000 tried to drop "ghn_locations_level_code_key" as a
-- constraint, but it was created as a standalone unique index. Remove both
-- forms so locations from different catalog generations can coexist.
ALTER TABLE "ghn_locations" DROP CONSTRAINT IF EXISTS "ghn_locations_level_code_key";
DROP INDEX IF EXISTS "ghn_locations_level_code_key";

-- Make sure the generation-scoped uniqueness exists even if the previous
-- migration was only partially applied.
CREATE UNIQUE INDEX IF NOT EXISTS "ghn_locations_catalog_generation_address_model_level_code_key"
  ON "ghn_locations" ("catalog_generation", "address_model", "level", "code");
