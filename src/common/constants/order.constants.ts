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
