import { NotificationType, OrderStatus, PaymentStatus } from '@prisma/client';
import { releaseOrderCouponRedemption } from '../../src/common/utils/coupon-redemption.util';
import { UNPAID_ORDER_TTL_MS } from '../../src/modules/orders/constants/order-flow.constants';
import { OrdersService } from '../../src/modules/orders/orders.service';

function createPrisma() {
  const prisma: any = {
    order: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
    couponRedemption: {
      findUnique: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

describe('releaseOrderCouponRedemption', () => {
  it('xoá lượt dùng và trả lại used_count đúng một lần', async () => {
    const tx = createPrisma();
    tx.couponRedemption.findUnique.mockResolvedValue({ id: 'r-1', couponId: 'coupon-1' });

    await expect(releaseOrderCouponRedemption(tx, 'order-1')).resolves.toBe(true);
    expect(tx.couponRedemption.deleteMany).toHaveBeenCalledWith({ where: { id: 'r-1' } });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);

    // Lần gọi thứ hai (đã bị xoá bởi luồng khác) không trả thêm lượt.
    tx.couponRedemption.deleteMany.mockResolvedValue({ count: 0 });
    await expect(releaseOrderCouponRedemption(tx, 'order-1')).resolves.toBe(false);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('đơn không dùng mã thì không làm gì', async () => {
    const tx = createPrisma();
    await expect(releaseOrderCouponRedemption(tx, 'order-1')).resolves.toBe(false);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('OrdersService.expireUnpaidOrders', () => {
  const now = new Date('2026-11-02T10:00:00.000Z');
  let prisma: any;
  let notifications: { create: jest.Mock };
  let service: OrdersService;

  beforeEach(() => {
    prisma = createPrisma();
    notifications = { create: jest.fn().mockResolvedValue({}) };
    service = new OrdersService(prisma, {} as any, notifications as any, {} as any, {} as any, {} as any);
  });

  it('hủy đơn quá hạn, hết hạn payment chờ, trả mã, ghi lịch sử và báo khách', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'order-1', userId: 'user-1', orderCode: 123, targetTier: null }]);
    prisma.couponRedemption.findUnique.mockResolvedValue({ id: 'r-1', couponId: 'coupon-1' });

    await expect(service.expireUnpaidOrders(now)).resolves.toEqual({ expired: 1, remaining: false });

    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({
      status: OrderStatus.CREATED,
      paymentStatus: PaymentStatus.PENDING,
      createdAt: { lt: new Date(now.getTime() - UNPAID_ORDER_TTL_MS) },
    });
    expect(prisma.order.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'order-1', status: OrderStatus.CREATED, paymentStatus: PaymentStatus.PENDING },
      data: { status: OrderStatus.CANCELLED, paymentStatus: PaymentStatus.EXPIRED },
    });
    expect(prisma.payment.updateMany.mock.calls[0][0].data).toEqual({ status: PaymentStatus.EXPIRED });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.orderEvent.create.mock.calls[0][0].data).toMatchObject({
      orderId: 'order-1',
      type: 'ORDER_PAYMENT_EXPIRED',
      toStatus: OrderStatus.CANCELLED,
    });
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', type: NotificationType.ORDER_STATUS }),
    );
  });

  it('đơn vừa được thanh toán giữa chừng thì bỏ qua, không trả mã', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'order-1', userId: 'user-1', orderCode: 123, targetTier: null }]);
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.expireUnpaidOrders(now)).resolves.toEqual({ expired: 0, remaining: false });
    expect(prisma.couponRedemption.findUnique).not.toHaveBeenCalled();
    expect(prisma.orderEvent.create).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('đơn nâng cấp gói hết hạn không gửi thông báo đơn hàng', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'order-2', userId: 'user-1', orderCode: 124, targetTier: 'VIP' }]);

    await expect(service.expireUnpaidOrders(now)).resolves.toEqual({ expired: 1, remaining: false });
    expect(notifications.create).not.toHaveBeenCalled();
  });
});
