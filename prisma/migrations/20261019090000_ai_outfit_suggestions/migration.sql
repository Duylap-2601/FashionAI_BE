-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "suggestions" JSONB;

-- AlterTable
ALTER TABLE "stylist_results" ALTER COLUMN "human_image_url" DROP NOT NULL;
