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

/**
 * Ghép chứng từ hoàn tiền mới vào chứng từ đã lưu trên đơn. Ảnh chứng từ được cộng
 * dồn qua các lần (duyệt yêu cầu, chốt hoàn tiền, hoàn lại khi khách báo chưa nhận
 * được tiền) để khách và shop xem đủ các bill. Không có gì mới thì trả về
 * `evidence` admin gửi (undefined = giữ nguyên chứng từ cũ).
 */
export function mergeRefundEvidence(
  current: unknown,
  update: { evidence?: Record<string, unknown>; reference?: string; receiptImageUrls: string[] },
): Record<string, unknown> | undefined {
  const reference = update.reference?.trim();
  if (!reference && update.receiptImageUrls.length === 0) {
    return update.evidence;
  }

  const currentEvidence =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  const previousImages = Array.isArray(currentEvidence.receiptImages)
    ? currentEvidence.receiptImages.filter((url): url is string => typeof url === 'string')
    : [];
  const receiptImages = [...new Set([...previousImages, ...update.receiptImageUrls])];

  return {
    ...currentEvidence,
    ...(update.evidence ?? {}),
    ...(reference ? { reference } : {}),
    ...(receiptImages.length > 0 ? { receiptImages } : {}),
  };
}
