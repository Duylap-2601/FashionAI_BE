-- CreateEnum
CREATE TYPE "ProductGender" AS ENUM ('FEMALE', 'MALE', 'UNISEX');

-- AlterTable
-- Toàn bộ sản phẩm hiện có là đồ nữ nên mặc định FEMALE; admin sửa tay khi thêm đồ nam/unisex.
ALTER TABLE "products" ADD COLUMN "gender" "ProductGender" NOT NULL DEFAULT 'FEMALE';
