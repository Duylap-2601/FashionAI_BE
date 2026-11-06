-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'DELIVERY_DISPUTED';

-- CreateEnum
CREATE TYPE "DeliveryDisputeStatus" AS ENUM ('OPEN', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryDisputeResolution" AS ENUM ('CUSTOMER_CONFIRMED_RECEIVED', 'ADMIN_CONFIRMED_RECEIVED', 'REFUNDED', 'LOST');

-- CreateTable
CREATE TABLE "delivery_disputes" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "DeliveryDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "DeliveryDisputeResolution",
    "description" TEXT NOT NULL,
    "evidence_images" JSONB,
    "carrier_raw_status" TEXT,
    "carrier_delivered_at" TIMESTAMP(3),
    "admin_note" TEXT,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_disputes_order_id_status_idx" ON "delivery_disputes"("order_id", "status");

-- CreateIndex
CREATE INDEX "delivery_disputes_user_id_created_at_idx" ON "delivery_disputes"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "delivery_disputes_status_created_at_idx" ON "delivery_disputes"("status", "created_at");

-- AddForeignKey
ALTER TABLE "delivery_disputes" ADD CONSTRAINT "delivery_disputes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_disputes" ADD CONSTRAINT "delivery_disputes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_disputes" ADD CONSTRAINT "delivery_disputes_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
