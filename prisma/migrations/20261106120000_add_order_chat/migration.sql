-- CreateEnum
CREATE TYPE "OrderChatSenderRole" AS ENUM ('CUSTOMER', 'ADMIN');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_CHAT';

-- CreateTable
CREATE TABLE "order_conversations" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "last_message_at" TIMESTAMP(3),
    "last_message_preview" TEXT,
    "customer_unread_count" INTEGER NOT NULL DEFAULT 0,
    "admin_unread_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_chat_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID,
    "sender_role" "OrderChatSenderRole" NOT NULL,
    "sender_name_snapshot" TEXT,
    "sender_avatar_snapshot" TEXT,
    "content" TEXT,
    "attachments" JSONB,
    "client_message_id" TEXT,
    "read_by_customer_at" TIMESTAMP(3),
    "read_by_admin_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_conversations_order_id_key" ON "order_conversations"("order_id");

-- CreateIndex
CREATE INDEX "order_conversations_customer_id_last_message_at_idx" ON "order_conversations"("customer_id", "last_message_at");

-- CreateIndex
CREATE INDEX "order_conversations_last_message_at_idx" ON "order_conversations"("last_message_at");

-- CreateIndex
CREATE INDEX "order_chat_messages_conversation_id_created_at_id_idx" ON "order_chat_messages"("conversation_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_chat_messages_conversation_id_client_message_id_key" ON "order_chat_messages"("conversation_id", "client_message_id");

-- AddForeignKey
ALTER TABLE "order_conversations" ADD CONSTRAINT "order_conversations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_conversations" ADD CONSTRAINT "order_conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_chat_messages" ADD CONSTRAINT "order_chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "order_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_chat_messages" ADD CONSTRAINT "order_chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
