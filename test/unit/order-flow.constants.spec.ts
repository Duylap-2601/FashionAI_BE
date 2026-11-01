import { OrderStatus } from '@prisma/client';
import { ORDER_STATUS_TRANSITIONS } from '../../src/modules/orders/constants/order-flow.constants';

describe('ORDER_STATUS_TRANSITIONS', () => {
  it('cho phép duyệt trả hàng từ các trạng thái sau khi giao', () => {
    for (const status of [
      OrderStatus.SHIPPING,
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
      OrderStatus.RETURN_REQUESTED,
    ]) {
      expect(ORDER_STATUS_TRANSITIONS[status]).toContain(OrderStatus.RETURN_APPROVED);
    }
  });

  it('RETURN_APPROVED đi tiếp được sang RETURNING và RETURNED', () => {
    expect(ORDER_STATUS_TRANSITIONS[OrderStatus.RETURN_APPROVED]).toEqual(
      expect.arrayContaining([OrderStatus.RETURNING, OrderStatus.RETURNED]),
    );
  });
});
