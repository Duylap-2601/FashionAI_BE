import { Prisma } from '@prisma/client';

/** Phần dữ liệu tối thiểu của một dòng đơn để tính giá trị hàng khai báo với GHN. */
export interface InsuredOrderItem {
  price: Prisma.Decimal | number | string;
  quantity: number;
}

/**
 * Giá trị hàng khai báo bảo hiểm khi tạo vận đơn: đơn giá đã chốt × số lượng.
 * Phải bằng `itemsTotal` dùng lúc báo giá phí ship, nếu không GHN tính phí bảo
 * hiểm khác và phí thực tế lệch với phí khách đã trả. Không dùng `order.amount`
 * vì số đó đã trừ mã giảm giá và cộng cả phí ship.
 */
export function shipmentInsuranceValueVnd(items: InsuredOrderItem[]): number {
  return items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
}
