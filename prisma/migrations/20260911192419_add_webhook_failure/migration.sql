-- CreateTable
CREATE TABLE "webhook_failures" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "order_code" INTEGER,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_failures_resolved_created_at_idx" ON "webhook_failures"("resolved", "created_at");
