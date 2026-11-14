-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'RENEWED';

-- Dữ liệu cũ: mỗi lần gia hạn trước đây tạo thêm một dòng ACTIVE mới, nên một user
-- có thể đang có nhiều dòng ACTIVE (đều còn hạn). Trước khi dựng partial unique
-- index, giữ lại dòng ACTIVE có "expires_at" xa nhất (quyền lợi lớn nhất) và
-- chuyển các dòng ACTIVE còn lại thành CANCELLED. Dòng còn lại giữ nguyên
-- "order_id" gốc, lịch sử mua vẫn đọc được qua bảng orders.
UPDATE "subscriptions" AS s
SET "status" = 'CANCELLED'
FROM (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "user_id"
            ORDER BY "expires_at" DESC, "created_at" DESC, "id" DESC
        ) AS "rank"
    FROM "subscriptions"
    WHERE "status" = 'ACTIVE'
) AS ranked
WHERE s."id" = ranked."id"
  AND ranked."rank" > 1;

-- Prisma không mô tả được partial unique index: mỗi user chỉ có tối đa MỘT dòng
-- ACTIVE. Các trạng thái khác (SCHEDULED/RENEWED/EXPIRED/CANCELLED) không bị chặn
-- nên vẫn giữ được nhiều dòng lịch sử.
CREATE UNIQUE INDEX "subscriptions_one_active_per_user"
    ON "subscriptions"("user_id")
    WHERE "status" = 'ACTIVE';
