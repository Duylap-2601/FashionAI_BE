import { OrderIssueReason, Prisma } from '@prisma/client';

type Money = Prisma.Decimal | bigint | number | string;

/** Lỗi từ phía shop: chính sách đổi trả hoàn cả phí giao hàng ban đầu của đơn. */
export const SHOP_FAULT_ISSUE_REASONS: readonly OrderIssueReason[] = [
  OrderIssueReason.WRONG_SIZE,
  OrderIssueReason.WRONG_COLOR,
  OrderIssueReason.QUALITY_MISMATCH,
];

export interface IssueRefundOrder {
  itemsSubtotalVnd: Money | null;
  discountVnd: Money | null;
  discountAmount: Money | null;
  shippingFeeVnd: Money | null;
  shippingFee: Money | null;
  items: IssueRefundOrderItem[];
}

export interface IssueRefundOrderItem {
  price: Money;
  quantity: number;
  lineTotalVnd: Money | null;
}

function lineTotalVnd(item: IssueRefundOrderItem): number {
  return item.lineTotalVnd != null ? Number(item.lineTotalVnd) : Number(item.price) * item.quantity;
}

/**
 * Số tiền hoàn cho một món bị báo lỗi theo chính sách đổi trả: giá khách thực trả
 * cho món đó (mã giảm giá chia theo giá trị món) và, khi lỗi từ phía shop, toàn bộ
 * phí giao hàng ban đầu của đơn. Phí giao chỉ hoàn một lần mỗi đơn: món lỗi thứ hai
 * truyền `shippingRefunded` để không cộng lại. Không lấy cả đơn: khách chỉ trả lại
 * món bị lỗi. Đơn cũ chưa lưu các cột *Vnd thì lấy từ cột Decimal.
 */
export function issueRefundAmountVnd(
  order: IssueRefundOrder,
  item: IssueRefundOrderItem,
  reason: OrderIssueReason,
  shippingRefunded = false,
): number {
  const itemVnd = lineTotalVnd(item);
  const subtotalVnd = order.itemsSubtotalVnd != null
    ? Number(order.itemsSubtotalVnd)
    : order.items.reduce((sum, line) => sum + lineTotalVnd(line), 0);
  const share = subtotalVnd > 0 ? Math.min(itemVnd / subtotalVnd, 1) : 1;
  const discountVnd = Number(order.discountVnd ?? order.discountAmount ?? 0);
  const shippingFeeVnd = SHOP_FAULT_ISSUE_REASONS.includes(reason) && !shippingRefunded
    ? Number(order.shippingFeeVnd ?? order.shippingFee ?? 0)
    : 0;
  return Math.max(0, Math.round(itemVnd - discountVnd * share + shippingFeeVnd));
}
