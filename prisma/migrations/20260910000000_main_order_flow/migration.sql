-- Additive migration for made-to-measure order flow, payment state, history and shipments.

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'MEASUREMENT_REVIEW';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'MEASUREMENT_CONFIRMED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'TAILORING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'QUALITY_CHECK';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'READY_TO_SHIP';

CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');
CREATE TYPE "RefundStatus" AS ENUM ('NONE', 'REQUIRED', 'PROCESSING', 'COMPLETED');
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'CREATED', 'PICKING', 'PICKED', 'IN_TRANSIT', 'DELIVERING', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNING', 'RETURNED', 'CANCELLED');

ALTER TABLE "orders" ADD COLUMN "fulfillment_flow_version" INTEGER;
ALTER TABLE "orders" ADD COLUMN "payment_status" "PaymentStatus";
ALTER TABLE "orders" ADD COLUMN "refund_status" "RefundStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "orders" ADD COLUMN "refund_evidence" JSONB;

ALTER TABLE "order_items" ADD COLUMN "product_name_snapshot" TEXT;
ALTER TABLE "order_items" ADD COLUMN "fabric_snapshot" TEXT;
ALTER TABLE "order_items" ADD COLUMN "measurement_review" JSONB;

CREATE TABLE "shipments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'GHN',
  "provider_order_code" TEXT,
  "request_key" TEXT NOT NULL,
  "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
  "shipping_fee" DECIMAL(10,2),
  "quoted_shipping_fee" DECIMAL(10,2),
  "actual_shipping_fee" DECIMAL(10,2),
  "expected_delivery_time" TIMESTAMP(3),
  "tracking_data" JSONB,
  "last_synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shipments_provider_provider_order_code_key" ON "shipments"("provider", "provider_order_code") WHERE "provider_order_code" IS NOT NULL;
CREATE UNIQUE INDEX "shipments_request_key_key" ON "shipments"("request_key");
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");
CREATE UNIQUE INDEX "shipments_one_active_per_order_key" ON "shipments"("order_id") WHERE "status" NOT IN ('DELIVERED', 'RETURNED', 'CANCELLED');

ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "order_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "shipment_id" UUID,
  "type" TEXT NOT NULL,
  "from_status" "OrderStatus",
  "to_status" "OrderStatus",
  "source" TEXT NOT NULL,
  "actor_id" UUID,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deduplication_key" TEXT,
  "public_message" TEXT,
  "internal_note" TEXT,
  "metadata" JSONB,
  CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_events_deduplication_key_key" ON "order_events"("deduplication_key") WHERE "deduplication_key" IS NOT NULL;
CREATE INDEX "order_events_order_id_occurred_at_idx" ON "order_events"("order_id", "occurred_at");

ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "event_key" TEXT NOT NULL,
  "provider_order_code" TEXT,
  "event_type" TEXT,
  "payload" JSONB,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_events_event_key_key" ON "webhook_events"("event_key");
CREATE INDEX "webhook_events_provider_provider_order_code_idx" ON "webhook_events"("provider", "provider_order_code");
