-- CreateEnum
CREATE TYPE "LayerRole" AS ENUM ('OUTER', 'INNER', 'BOTTOM', 'FULL_BODY');

-- AlterTable
ALTER TABLE "products" ADD COLUMN "layer_role" "LayerRole";

-- Backfill để filter layerRole không bỏ sót dữ liệu cũ.
-- Admin vẫn có thể sửa tay các trường hợp VEST (waistcoat vs blazer).
UPDATE "products"
SET "layer_role" = CASE
  WHEN "garment_type" IN ('JACKET', 'VEST') THEN 'OUTER'::"LayerRole"
  WHEN "garment_type" = 'SHIRT' THEN 'INNER'::"LayerRole"
  WHEN "garment_type" IN ('PANTS', 'SKIRT') THEN 'BOTTOM'::"LayerRole"
  WHEN "garment_type" IN ('DRESS', 'JUMPSUIT') THEN 'FULL_BODY'::"LayerRole"
  WHEN "category" = 'LOWER' THEN 'BOTTOM'::"LayerRole"
  WHEN "category" = 'FULL_BODY' THEN 'FULL_BODY'::"LayerRole"
  ELSE 'INNER'::"LayerRole"
END;
