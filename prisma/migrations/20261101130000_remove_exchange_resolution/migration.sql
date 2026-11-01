-- Chỉ còn hướng xử lý hoàn tiền; dọn dữ liệu cũ (nếu có) rồi tạo lại enum.
UPDATE "order_issues" SET "desired_resolution" = 'REFUND' WHERE "desired_resolution" = 'EXCHANGE';
UPDATE "order_issues" SET "approved_resolution" = 'REFUND' WHERE "approved_resolution" = 'EXCHANGE';

ALTER TYPE "OrderIssueResolution" RENAME TO "OrderIssueResolution_old";
CREATE TYPE "OrderIssueResolution" AS ENUM ('REFUND');
ALTER TABLE "order_issues"
  ALTER COLUMN "desired_resolution" TYPE "OrderIssueResolution"
  USING "desired_resolution"::text::"OrderIssueResolution";
ALTER TABLE "order_issues"
  ALTER COLUMN "approved_resolution" TYPE "OrderIssueResolution"
  USING "approved_resolution"::text::"OrderIssueResolution";
DROP TYPE "OrderIssueResolution_old";
