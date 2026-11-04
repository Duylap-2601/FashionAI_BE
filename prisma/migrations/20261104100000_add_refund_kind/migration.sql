-- CreateEnum
CREATE TYPE "RefundKind" AS ENUM ('GOODS', 'SHIPPING');

-- AlterTable
-- Khoản hoàn cũ đều là tiền hàng (phí ship trước đây gộp chung vào cùng khoản).
ALTER TABLE "refunds" ADD COLUMN "kind" "RefundKind" NOT NULL DEFAULT 'GOODS';
