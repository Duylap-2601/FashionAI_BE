import { PaymentStatus } from '@prisma/client';

/**
 * Suy ra trạng thái thanh toán của đơn sau khi đã hoàn một phần/toàn bộ tiền.
 * Luôn dựa trên số tiền đã thu và số tiền đã hoàn thực tế, không dựa vào yêu cầu
 * hoàn tiền đang chờ xử lý.
 */
export function resolveRefundPaymentStatus(
  collectedVnd: number,
  refundedVnd: number,
): PaymentStatus {
  if (refundedVnd <= 0) return PaymentStatus.PAID;
  return refundedVnd >= collectedVnd
    ? PaymentStatus.REFUNDED
    : PaymentStatus.PARTIALLY_REFUNDED;
}

/**
 * Số tiền hoàn cho một lần cập nhật refund thủ công: ưu tiên số admin nhập, sau
 * đó tới số đã duyệt trên bản ghi refund đang mở, cuối cùng là phần còn lại của
 * đơn. Luôn chặn trần bằng phần còn lại để không hoàn vượt số đã thu.
 */
export function resolveManualRefundAmount(input: {
  requestedVnd?: number;
  openAmountVnd?: number;
  collectedVnd: number;
  completedVnd: number;
}): { amountVnd: number; remainingVnd: number } {
  const remainingVnd = Math.max(input.collectedVnd - input.completedVnd, 0);
  const approvedVnd = input.openAmountVnd ?? 0;
  const fallbackVnd = approvedVnd > 0 ? Math.min(approvedVnd, remainingVnd) : remainingVnd;
  return {
    amountVnd: input.requestedVnd ?? fallbackVnd,
    remainingVnd,
  };
}
