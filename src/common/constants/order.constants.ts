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
 * Phần khách chọn mua của sản phẩm combo suit: nguyên bộ, chỉ áo blazer, hoặc
 * lẻ sơ mi/váy/quần. Dùng chung cho giỏ hàng và dòng đơn hàng.
 */
export const COMBO_TYPES = ['combo', 'blazer', 'retail'] as const;
export type ComboType = (typeof COMBO_TYPES)[number];
