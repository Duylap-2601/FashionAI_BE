import { OrderIssueReason, Prisma } from '@prisma/client';

type Money = Prisma.Decimal | bigint | number | string;

/** Lỗi từ phía shop: mặc định đề xuất hoàn cả phí ship ban đầu (admin vẫn chọn được). */
export const SHOP_FAULT_ISSUE_REASONS: readonly OrderIssueReason[] = [
  OrderIssueReason.WRONG_SIZE,
  OrderIssueReason.WRONG_COLOR,
  OrderIssueReason.QUALITY_MISMATCH,
];

export interface IssueRefundOrder {
  itemsSubtotalVnd: Money | null;
  discountVnd: Money | null;
  discountAmount: Money | null;
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
 * Tiền hàng hoàn cho một món bị báo lỗi theo chính sách đổi trả: giá khách thực trả
 * cho món đó (mã giảm giá chia theo giá trị món). Phí ship ban đầu là khoản hoàn
 * riêng (`orderShippingFeeVnd`), admin chọn có hoàn hay không. Đơn cũ chưa lưu các
 * cột *Vnd thì lấy từ cột Decimal.
 */
export function issueRefundAmountVnd(order: IssueRefundOrder, item: IssueRefundOrderItem): number {
  const itemVnd = lineTotalVnd(item);
  const subtotalVnd = order.itemsSubtotalVnd != null
    ? Number(order.itemsSubtotalVnd)
    : order.items.reduce((sum, line) => sum + lineTotalVnd(line), 0);
  const share = subtotalVnd > 0 ? Math.min(itemVnd / subtotalVnd, 1) : 1;
  const discountVnd = Number(order.discountVnd ?? order.discountAmount ?? 0);
  return Math.max(0, Math.round(itemVnd - discountVnd * share));
}

/** Phí giao hàng ban đầu của đơn (khoản hoàn phí ship, mỗi đơn tối đa một lần). */
export function orderShippingFeeVnd(order: { shippingFeeVnd: Money | null; shippingFee: Money | null }): number {
  return Math.max(0, Math.round(Number(order.shippingFeeVnd ?? order.shippingFee ?? 0)));
}
