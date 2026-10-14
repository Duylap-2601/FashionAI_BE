import { createHash } from 'crypto';
import { OrdersService } from '../../src/modules/orders/orders.service';

describe('OrdersService fingerprint', () => {
  const service = new OrdersService(null as never, null as never, null as never, null as never, null as never);
  const fingerprint = (dto: unknown) => service['buildOrderFingerprint']('user-1', dto as never);

  const baseDto = {
    items: [
      { productId: 'product-b', quantity: 1, color: 'Black' },
      { productId: 'product-a', quantity: 2 },
    ],
    shippingAddressId: 'address-1',
    addressVersion: 3,
    shippingInfo: {},
  };

  it('payload không có comboType giữ nguyên fingerprint như trước khi thêm comboType', () => {
    // Đúng cấu trúc payload cũ: quote token / idempotency key tạo trước khi deploy vẫn khớp.
    const legacy = createHash('sha256')
      .update(
        JSON.stringify({
          userId: 'user-1',
          items: [
            { productId: 'product-a', quantity: 2, color: null },
            { productId: 'product-b', quantity: 1, color: 'Black' },
          ],
          couponCode: null,
          shippingAddressId: 'address-1',
          addressVersion: 3,
          shippingInfo: null,
          shippingNote: '',
        }),
      )
      .digest('hex');

    expect(fingerprint(baseDto)).toBe(legacy);
  });

  it('comboType khác nhau cho fingerprint khác nhau', () => {
    const withCombo = (comboType: string) => ({
      ...baseDto,
      items: [{ productId: 'product-a', quantity: 1, color: 'Black', comboType }],
    });

    expect(fingerprint(withCombo('combo'))).not.toBe(fingerprint(withCombo('blazer')));
  });
});
