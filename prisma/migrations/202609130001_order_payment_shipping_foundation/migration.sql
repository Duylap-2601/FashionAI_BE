-- Phase 1 foundation for Order -> Payment -> Shipment.

-- 1. Add new enum values FIRST (before any table/column uses them as defaults)
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RETURN_REQUESTED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RETURN_APPROVED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RETURNING';

ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUND_REQUIRED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUND_PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'COD_COLLECTED';

ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'READY_TO_PICK';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'SHIPPING';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'FAILED';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WebhookEventStatus') THEN
    CREATE TYPE "WebhookEventStatus" AS ENUM (
      'RECEIVED',
      'PROCESSING',
      'PROCESSED',
      'FAILED_RETRYABLE',
      'FAILED_DEAD',
      'IGNORED_DUPLICATE'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OutboxEventStatus') THEN
    CREATE TYPE "OutboxEventStatus" AS ENUM (
      'PENDING',
      'PROCESSING',
      'PROCESSED',
      'FAILED_RETRYABLE',
      'FAILED_DEAD'
    );
  END IF;
END $$;

-- 2. Add columns to existing tables
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "items_subtotal_vnd" BIGINT,
  ADD COLUMN IF NOT EXISTS "shipping_fee_vnd" BIGINT,
  ADD COLUMN IF NOT EXISTS "discount_vnd" BIGINT,
  ADD COLUMN IF NOT EXISTS "tax_vnd" BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_vnd" BIGINT,
  ADD COLUMN IF NOT EXISTS "amount_paid_vnd" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "amount_refunded_vnd" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'VND',
  ADD COLUMN IF NOT EXISTS "shipping_address_snapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "shipping_quote_snapshot" JSONB;

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "product_sku_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "product_image_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "product_category_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "brand_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "unit_price_vnd" BIGINT,
  ADD COLUMN IF NOT EXISTS "line_total_vnd" BIGINT;

ALTER TABLE "shipments"
  ADD COLUMN IF NOT EXISTS "raw_status" TEXT,
  ADD COLUMN IF NOT EXISTS "shipping_fee_vnd" BIGINT,
  ADD COLUMN IF NOT EXISTS "tracking_url" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_event_at" TIMESTAMP(3);

ALTER TABLE "webhook_events"
  ADD COLUMN IF NOT EXISTS "provider_event_id" TEXT,
  ADD COLUMN IF NOT EXISTS "status" "WebhookEventStatus" NOT NULL DEFAULT 'PROCESSED',
  ADD COLUMN IF NOT EXISTS "signature_valid" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "order_id" UUID,
  ADD COLUMN IF NOT EXISTS "payment_id" UUID,
  ADD COLUMN IF NOT EXISTS "shipment_id" UUID,
  ADD COLUMN IF NOT EXISTS "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_error" TEXT;

ALTER TABLE "webhook_events"
  ALTER COLUMN "processed_at" DROP NOT NULL,
  ALTER COLUMN "processed_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "order_events"
  ADD COLUMN IF NOT EXISTS "from_payment_status" "PaymentStatus",
  ADD COLUMN IF NOT EXISTS "to_payment_status" "PaymentStatus",
  ADD COLUMN IF NOT EXISTS "from_shipment_status" "ShipmentStatus",
  ADD COLUMN IF NOT EXISTS "to_shipment_status" "ShipmentStatus";

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "method" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_payment_id" TEXT,
  ADD COLUMN IF NOT EXISTS "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "amount_vnd" BIGINT,
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'VND',
  ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "refunded_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failure_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3. Create refunds table WITHOUT enum default first, then ALTER to set it
CREATE TABLE IF NOT EXISTS "refunds" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "payment_id" UUID,
  "provider" TEXT NOT NULL DEFAULT 'MANUAL',
  "provider_refund_id" TEXT,
  "amount_vnd" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "reason" TEXT,
  "status" "RefundStatus" NOT NULL,
  "idempotency_key" TEXT,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "failed_reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- Now safe to set the default since enum values are committed
ALTER TABLE "refunds" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- 4. Create outbox_events table
CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id" UUID NOT NULL,
  "event_key" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "payload" JSONB,
  "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_run_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- 5. Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_order_id_fkey') THEN
    ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_payment_id_fkey') THEN
    ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 6. Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_provider_provider_event_id_key" ON "webhook_events"("provider", "provider_event_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_provider_payment_id_key" ON "payments"("provider", "provider_payment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotency_key_key" ON "payments"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_provider_provider_refund_id_key" ON "refunds"("provider", "provider_refund_id");
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_idempotency_key_key" ON "refunds"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "outbox_events_event_key_key" ON "outbox_events"("event_key");

-- 7. Indexes
CREATE INDEX IF NOT EXISTS "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "orders_status_created_at_idx" ON "orders"("status", "created_at");
CREATE INDEX IF NOT EXISTS "orders_payment_status_created_at_idx" ON "orders"("payment_status", "created_at");
CREATE INDEX IF NOT EXISTS "orders_checkout_expires_at_idx" ON "orders"("checkout_expires_at");
CREATE INDEX IF NOT EXISTS "shipments_order_id_status_idx" ON "shipments"("order_id", "status");
CREATE INDEX IF NOT EXISTS "shipments_provider_status_idx" ON "shipments"("provider", "status");
CREATE INDEX IF NOT EXISTS "webhook_events_provider_event_type_received_at_idx" ON "webhook_events"("provider", "event_type", "received_at");
CREATE INDEX IF NOT EXISTS "webhook_events_order_id_idx" ON "webhook_events"("order_id");
CREATE INDEX IF NOT EXISTS "webhook_events_payment_id_idx" ON "webhook_events"("payment_id");
CREATE INDEX IF NOT EXISTS "webhook_events_shipment_id_idx" ON "webhook_events"("shipment_id");
CREATE INDEX IF NOT EXISTS "payments_order_id_status_idx" ON "payments"("order_id", "status");
CREATE INDEX IF NOT EXISTS "payments_order_id_created_at_idx" ON "payments"("order_id", "created_at");
CREATE INDEX IF NOT EXISTS "payments_provider_created_at_idx" ON "payments"("provider", "created_at");
CREATE INDEX IF NOT EXISTS "refunds_order_id_status_idx" ON "refunds"("order_id", "status");
CREATE INDEX IF NOT EXISTS "refunds_payment_id_idx" ON "refunds"("payment_id");
CREATE INDEX IF NOT EXISTS "outbox_events_status_next_run_at_idx" ON "outbox_events"("status", "next_run_at");
CREATE INDEX IF NOT EXISTS "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");
