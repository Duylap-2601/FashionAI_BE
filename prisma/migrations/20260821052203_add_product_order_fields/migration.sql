-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "coupon_code" TEXT,
ADD COLUMN     "discount_amount" DECIMAL(10,2),
ADD COLUMN     "payment_method" TEXT,
ADD COLUMN     "shipping_fee" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "brand" TEXT DEFAULT 'StAle. SIGNATURE',
ADD COLUMN     "colors" JSONB,
ADD COLUMN     "original_price" DECIMAL(10,2),
ADD COLUMN     "sizes" JSONB,
ADD COLUMN     "stock" INTEGER NOT NULL DEFAULT 0;
