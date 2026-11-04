import { issueRefundAmountVnd, orderShippingFeeVnd } from '../../src/modules/order-issues/utils/issue-refund-amount.util';

const blazer = { price: 750_000, quantity: 1, lineTotalVnd: BigInt(750_000) };
const shirt = { price: 550_000, quantity: 1, lineTotalVnd: BigInt(550_000) };
const trousers = { price: 550_000, quantity: 1, lineTotalVnd: BigInt(550_000) };

function order(overrides: Partial<Parameters<typeof issueRefundAmountVnd>[0]> = {}) {
  return {
    itemsSubtotalVnd: BigInt(1_850_000),
    discountVnd: BigInt(0),
    discountAmount: null,
    items: [blazer, shirt, trousers],
    ...overrides,
  };
}

describe('issueRefundAmountVnd', () => {
  it('tiền hàng chỉ gồm món bị lỗi, không gộp phí ship', () => {
    // Đơn 1.880.150đ (3 món + 30.150đ ship), khách báo lỗi áo blazer 750.000đ.
    expect(issueRefundAmountVnd(order(), blazer)).toBe(750_000);
  });

  it('trừ phần mã giảm giá của món theo giá trị món', () => {
    expect(issueRefundAmountVnd(order({ discountVnd: BigInt(185_000) }), blazer)).toBe(675_000);
  });

  it('đơn cũ chưa có cột *Vnd lấy từ cột Decimal và tổng các dòng', () => {
    const legacyItem = { price: '300000.00', quantity: 2, lineTotalVnd: null };
    const other = { price: '400000.00', quantity: 1, lineTotalVnd: null };
    const legacy = { itemsSubtotalVnd: null, discountVnd: null, discountAmount: '100000.00', items: [legacyItem, other] };
    // Món chiếm 600k/1tr: hoàn 600k - 60k giảm giá.
    expect(issueRefundAmountVnd(legacy, legacyItem)).toBe(540_000);
  });
});

describe('orderShippingFeeVnd', () => {
  it('lấy phí ship ban đầu, đơn cũ lấy từ cột Decimal', () => {
    expect(orderShippingFeeVnd({ shippingFeeVnd: BigInt(30_150), shippingFee: null })).toBe(30_150);
    expect(orderShippingFeeVnd({ shippingFeeVnd: null, shippingFee: '20000.00' })).toBe(20_000);
    expect(orderShippingFeeVnd({ shippingFeeVnd: null, shippingFee: null })).toBe(0);
  });
});
