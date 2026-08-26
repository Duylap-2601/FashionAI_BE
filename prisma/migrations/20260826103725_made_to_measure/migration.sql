-- Made-to-measure: bỏ size S/M/L khỏi sản phẩm & order item, thêm snapshot số đo, đổi recommended_size -> fit_advice

-- Product: bỏ cột size (S/M/L) và sizes (mảng size)
ALTER TABLE "products" DROP COLUMN IF EXISTS "size";
ALTER TABLE "products" DROP COLUMN IF EXISTS "sizes";

-- OrderItem: bỏ size, thêm snapshot số đo tại thời điểm đặt (đặt may theo số đo)
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "size";
ALTER TABLE "order_items" ADD COLUMN "measurement_snapshot" JSONB;

-- StylistResult: đổi tên recommended_size -> fit_advice (không còn tư vấn theo S/M/L)
ALTER TABLE "stylist_results" RENAME COLUMN "recommended_size" TO "fit_advice";
