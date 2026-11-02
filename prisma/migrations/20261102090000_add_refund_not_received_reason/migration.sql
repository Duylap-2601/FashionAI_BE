-- Khách báo chưa nhận được tiền hoàn sau khi shop đã chuyển khoản.
ALTER TYPE "OrderIssueReason" ADD VALUE IF NOT EXISTS 'REFUND_NOT_RECEIVED';
