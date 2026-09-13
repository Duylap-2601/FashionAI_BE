CREATE INDEX IF NOT EXISTS "shipments_status_created_at_idx" ON "shipments"("status", "created_at");
CREATE INDEX IF NOT EXISTS "shipments_provider_order_code_idx" ON "shipments"("provider_order_code");
CREATE INDEX IF NOT EXISTS "shipments_last_synced_at_idx" ON "shipments"("last_synced_at");
CREATE INDEX IF NOT EXISTS "shipments_expected_delivery_time_idx" ON "shipments"("expected_delivery_time");
CREATE INDEX IF NOT EXISTS "shipments_raw_status_created_at_idx" ON "shipments"("raw_status", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "shipments_one_active_per_order_key"
ON "shipments"("order_id")
WHERE "status" NOT IN ('DELIVERED', 'RETURNED', 'CANCELLED');
