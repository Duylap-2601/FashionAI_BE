-- Đổi tên thương hiệu "StAle." thành "StAie.": giá trị mặc định, sản phẩm hiện có và snapshot trong đơn cũ.
ALTER TABLE "products" ALTER COLUMN "brand" SET DEFAULT 'StAie. SIGNATURE';

UPDATE "products" SET "brand" = REPLACE("brand", 'StAle.', 'StAie.') WHERE "brand" LIKE '%StAle.%';

UPDATE "order_items" SET "brand_snapshot" = REPLACE("brand_snapshot", 'StAle.', 'StAie.') WHERE "brand_snapshot" LIKE '%StAle.%';
