import { PaymentStatus } from '@prisma/client';

/**
 * Các trạng thái thanh toán nghĩa là tiền đã về. Không suy luận doanh thu từ
 * vòng đời fulfilment của Order.status.
 */
export const COLLECTED_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
  PaymentStatus.COD_COLLECTED,
];

/**
 * Trạng thái thanh toán được coi là đã thu tiền khi tính doanh thu. Rộng hơn
 * COLLECTED_PAYMENT_STATUSES vì đơn đang chờ hoàn tiền (REFUND_PENDING /
 * REFUND_REQUIRED) vẫn là tiền đã về tay shop; phần hoàn sẽ được trừ qua
 * Order.amountRefundedVnd chứ không loại cả đơn khỏi doanh thu.
 */
export const REVENUE_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
  PaymentStatus.COD_COLLECTED,
  PaymentStatus.REFUND_PENDING,
  PaymentStatus.REFUND_REQUIRED,
];

/**
 * Phần khách chọn mua của sản phẩm combo suit: nguyên bộ, chỉ áo blazer, hoặc
 * lẻ sơ mi/váy/quần. Dùng chung cho giỏ hàng và dòng đơn hàng.
 */
export const COMBO_TYPES = ['combo', 'blazer', 'retail'] as const;
export type ComboType = (typeof COMBO_TYPES)[number];
