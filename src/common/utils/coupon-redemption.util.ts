import { Prisma } from '@prisma/client';

/**
 * Đơn chưa trả tiền bị hủy (khách hủy, admin hủy, cổng báo hủy giao dịch, quá hạn
 * thanh toán): trả lại lượt mã giảm giá đã giữ lúc tạo đơn. Gọi trong cùng
 * transaction với lần đổi trạng thái; gọi hai lần cũng chỉ trả một lượt.
 */
export async function releaseOrderCouponRedemption(tx: Prisma.TransactionClient, orderId: string) {
  const redemption = await tx.couponRedemption.findUnique({
    where: { orderId },
    select: { id: true, couponId: true },
  });
  if (!redemption) return false;

  const { count } = await tx.couponRedemption.deleteMany({ where: { id: redemption.id } });
  if (count === 0) return false;

  await tx.$executeRaw`
    UPDATE coupons
    SET used_count = GREATEST(used_count - 1, 0)
    WHERE id = ${redemption.couponId}::uuid
  `;
  return true;
}
