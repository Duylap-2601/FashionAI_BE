-- Luu lai lien ket thanh toan da tao de user co the quay lai tra tien cho don hang PENDING
ALTER TABLE "orders" ADD COLUMN "payment_provider" TEXT;
ALTER TABLE "orders" ADD COLUMN "checkout_url" TEXT;
ALTER TABLE "orders" ADD COLUMN "checkout_expires_at" TIMESTAMP(3);
