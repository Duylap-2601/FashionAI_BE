import { OrderIssueReason } from '@prisma/client';
import { issueRefundAmountVnd } from '../../src/modules/order-issues/utils/issue-refund-amount.util';

const blazer = { price: 750_000, quantity: 1, lineTotalVnd: BigInt(750_000) };
const shirt = { price: 550_000, quantity: 1, lineTotalVnd: BigInt(550_000) };
const trousers = { price: 550_000, quantity: 1, lineTotalVnd: BigInt(550_000) };

function order(overrides: Partial<Parameters<typeof issueRefundAmountVnd>[0]> = {}) {
  return {
    itemsSubtotalVnd: BigInt(1_850_000),
    discountVnd: BigInt(0),
    discountAmount: null,
    shippingFeeVnd: BigInt(30_150),
    shippingFee: null,
    items: [blazer, shirt, trousers],
    ...overrides,
  };
}

describe('issueRefundAmountVnd', () => {
  it('chỉ hoàn món bị lỗi kèm toàn bộ phí ship ban đầu, không hoàn cả đơn', () => {
    // Đơn 1.880.150đ (3 món + 30.150đ ship), khách báo sai số đo áo blazer 750.000đ.
    expect(issueRefundAmountVnd(order(), blazer, OrderIssueReason.WRONG_SIZE)).toBe(780_150);
  });

  it('phí ship chỉ hoàn một lần mỗi đơn', () => {
    expect(issueRefundAmountVnd(order(), shirt, OrderIssueReason.WRONG_COLOR, true)).toBe(550_000);
  });

  it('trừ phần mã giảm giá của món theo giá trị món', () => {
    expect(
      issueRefundAmountVnd(order({ discountVnd: BigInt(185_000) }), blazer, OrderIssueReason.QUALITY_MISMATCH),
    ).toBe(705_150);
  });

  it('lý do khác (không do shop) không hoàn phí vận chuyển', () => {
    expect(issueRefundAmountVnd(order(), blazer, OrderIssueReason.OTHER)).toBe(750_000);
  });

  it('đơn một món lỗi do shop hoàn đúng số khách đã trả', () => {
    const item = { price: 500_000, quantity: 1, lineTotalVnd: BigInt(500_000) };
    const single = order({ itemsSubtotalVnd: BigInt(500_000), discountVnd: BigInt(50_000), shippingFeeVnd: BigInt(20_000), items: [item] });
    expect(issueRefundAmountVnd(single, item, OrderIssueReason.WRONG_COLOR)).toBe(470_000);
  });

  it('đơn cũ chưa có cột *Vnd lấy từ cột Decimal và tổng các dòng', () => {
    const legacyItem = { price: '300000.00', quantity: 2, lineTotalVnd: null };
    const other = { price: '400000.00', quantity: 1, lineTotalVnd: null };
    const legacy = {
      itemsSubtotalVnd: null,
      discountVnd: null,
      discountAmount: '100000.00',
      shippingFeeVnd: null,
      shippingFee: '20000.00',
      items: [legacyItem, other],
    };
    // Món chiếm 600k/1tr: hoàn 600k - 60k giảm giá + 20k ship.
    expect(issueRefundAmountVnd(legacy, legacyItem, OrderIssueReason.WRONG_SIZE)).toBe(560_000);
  });
});
