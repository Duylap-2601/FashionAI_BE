CREATE TABLE "user_addresses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "label" TEXT,
    "ghn_province_id" INTEGER NOT NULL,
    "ghn_district_id" INTEGER NOT NULL,
    "ghn_ward_code" TEXT NOT NULL,
    "province_name" TEXT NOT NULL,
    "district_name" TEXT NOT NULL,
    "ward_name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_addresses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_idempotency_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "order_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_addresses_user_id_idx" ON "user_addresses"("user_id");
CREATE INDEX "user_addresses_user_id_created_at_idx" ON "user_addresses"("user_id", "created_at");
CREATE UNIQUE INDEX "user_addresses_one_default_per_user" ON "user_addresses"("user_id") WHERE "is_default" = true;

CREATE UNIQUE INDEX "order_idempotency_keys_user_id_key_key" ON "order_idempotency_keys"("user_id", "key");
CREATE INDEX "order_idempotency_keys_user_id_created_at_idx" ON "order_idempotency_keys"("user_id", "created_at");

ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_idempotency_keys" ADD CONSTRAINT "order_idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_idempotency_keys" ADD CONSTRAINT "order_idempotency_keys_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
