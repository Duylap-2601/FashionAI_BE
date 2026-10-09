-- CreateEnum
CREATE TYPE "OrderIssueReason" AS ENUM ('WRONG_SIZE', 'WRONG_COLOR', 'QUALITY_MISMATCH', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderIssueResolution" AS ENUM ('REFUND', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "OrderIssueStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RESOLVED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_ISSUE';

-- CreateTable
CREATE TABLE "order_issues" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" "OrderIssueReason" NOT NULL,
    "description" TEXT NOT NULL,
    "desired_resolution" "OrderIssueResolution" NOT NULL,
    "approved_resolution" "OrderIssueResolution",
    "evidence_images" JSONB,
    "status" "OrderIssueStatus" NOT NULL DEFAULT 'PENDING',
    "admin_note" TEXT,
    "admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_issues_order_id_idx" ON "order_issues"("order_id");

-- CreateIndex
CREATE INDEX "order_issues_order_item_id_idx" ON "order_issues"("order_item_id");

-- CreateIndex
CREATE INDEX "order_issues_user_id_idx" ON "order_issues"("user_id");

-- CreateIndex
CREATE INDEX "order_issues_status_created_at_idx" ON "order_issues"("status", "created_at");

-- AddForeignKey
ALTER TABLE "order_issues" ADD CONSTRAINT "order_issues_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_issues" ADD CONSTRAINT "order_issues_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_issues" ADD CONSTRAINT "order_issues_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_issues" ADD CONSTRAINT "order_issues_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
