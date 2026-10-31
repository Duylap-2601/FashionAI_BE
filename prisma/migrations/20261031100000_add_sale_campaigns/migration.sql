-- CreateTable
CREATE TABLE "sale_campaigns" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_campaigns_is_active_starts_at_ends_at_idx" ON "sale_campaigns"("is_active", "starts_at", "ends_at");

-- CreateTable
CREATE TABLE "sale_campaign_items" (
    "campaign_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,

    CONSTRAINT "sale_campaign_items_pkey" PRIMARY KEY ("campaign_id","product_id")
);

-- CreateIndex
CREATE INDEX "sale_campaign_items_product_id_idx" ON "sale_campaign_items"("product_id");

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "list_unit_price_vnd" BIGINT;

-- AddForeignKey
ALTER TABLE "sale_campaign_items" ADD CONSTRAINT "sale_campaign_items_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "sale_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_campaign_items" ADD CONSTRAINT "sale_campaign_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
