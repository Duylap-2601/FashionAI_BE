-- AlterTable
ALTER TABLE "orders"
  ADD COLUMN "refund_bank_name" TEXT,
  ADD COLUMN "refund_account_number" TEXT,
  ADD COLUMN "refund_account_holder" TEXT;

-- AlterTable
ALTER TABLE "order_issues"
  ADD COLUMN "bank_name" TEXT,
  ADD COLUMN "account_number" TEXT,
  ADD COLUMN "account_holder" TEXT;
