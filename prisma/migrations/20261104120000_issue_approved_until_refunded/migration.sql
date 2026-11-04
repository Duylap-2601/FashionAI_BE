-- Duyệt yêu cầu giờ để ở APPROVED ("đã duyệt, chờ hoàn tiền") và chỉ sang RESOLVED khi
-- mọi khoản hoàn của đơn đã chuyển. Yêu cầu đã duyệt theo luật cũ (RESOLVED ngay lúc
-- duyệt) mà đơn còn khoản hoàn chưa chuyển thì đưa về APPROVED. Không xoá dữ liệu.
UPDATE "order_issues" AS oi
SET "status" = 'APPROVED'
WHERE oi."status" = 'RESOLVED'
  AND oi."approved_resolution" = 'REFUND'
  AND EXISTS (
    SELECT 1 FROM "refunds" AS r
    WHERE r."order_id" = oi."order_id"
      AND r."provider" = 'MANUAL'
      AND r."status" IN ('REQUIRED', 'PENDING', 'PROCESSING')
  );
