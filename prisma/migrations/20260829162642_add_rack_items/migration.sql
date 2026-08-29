-- CreateTable
CREATE TABLE "rack_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rack_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rack_items_user_id_idx" ON "rack_items"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "rack_items_user_id_product_id_key" ON "rack_items"("user_id", "product_id");

-- AddForeignKey
ALTER TABLE "rack_items" ADD CONSTRAINT "rack_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rack_items" ADD CONSTRAINT "rack_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
