-- AlterEnum
ALTER TYPE "AiActionType" ADD VALUE 'CHATBOT';

-- AlterTable
ALTER TABLE "stylist_results" ADD COLUMN     "budget" TEXT,
ADD COLUMN     "gender_preference" TEXT,
ADD COLUMN     "input_context" JSONB,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "product_id" UUID,
ADD COLUMN     "raw_provider_response" JSONB,
ADD COLUMN     "recommended_size" TEXT,
ADD COLUMN     "style_preference" TEXT;

-- CreateIndex
CREATE INDEX "stylist_results_product_id_idx" ON "stylist_results"("product_id");

-- AddForeignKey
ALTER TABLE "stylist_results" ADD CONSTRAINT "stylist_results_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
