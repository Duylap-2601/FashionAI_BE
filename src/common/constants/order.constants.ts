import { OrderStatus } from '@prisma/client';

/**
 * Các trạng thái nghĩa là tiền đã về. Đơn sản phẩm sau khi PAID còn đi tiếp qua
 * CONFIRMED → SHIPPING → DELIVERED, nên thống kê doanh thu chỉ đếm PAID sẽ hụt
 * ngay khi admin xác nhận đơn.
 */
export const PAID_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.CONFIRMED,
  OrderStatus.SHIPPING,
  OrderStatus.DELIVERED,
];
