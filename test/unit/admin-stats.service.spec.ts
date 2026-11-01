import { OrderStatus, PaymentStatus } from '@prisma/client';
import { AdminStatsService } from '../../src/modules/admin/admin-stats.service';
import { PrismaService } from '../../src/database/prisma.service';

function createPrismaMock() {
  return {
    user: { count: jest.fn().mockResolvedValue(10) },
    product: { count: jest.fn().mockResolvedValue(5) },
    order: {
      count: jest.fn().mockResolvedValue(7),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    tryOnResult: { count: jest.fn().mockResolvedValue(3) },
    dailyUsage: { aggregate: jest.fn().mockResolvedValue({ _sum: { count: 2 } }) },
    stylistResult: { count: jest.fn().mockResolvedValue(1) },
  };
}

describe('AdminStatsService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: AdminStatsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new AdminStatsService(prisma as unknown as PrismaService);
  });

  it('tính net doanh thu bằng gross trừ hoàn tiền đúng một lần', async () => {
    prisma.order.groupBy.mockResolvedValue([
      {
        targetTier: null,
        _sum: { amountPaidVnd: 1_000_000n, amountRefundedVnd: 200_000n },
        _count: { _all: 2 },
      },
      {
        targetTier: 'PLUS',
        _sum: { amountPaidVnd: 500_000n, amountRefundedVnd: 0n },
        _count: { _all: 1 },
      },
    ]);

    const stats = await service.getStats();

    expect(stats.totalRevenue).toBe(1_500_000);
    expect(stats.refundedAmount).toBe(200_000);
    expect(stats.netRevenue).toBe(1_300_000);
    expect(stats.productRevenue).toBe(1_000_000);
    expect(stats.netProductRevenue).toBe(800_000);
    expect(stats.subscriptionRevenue).toBe(500_000);
    expect(stats.netSubscriptionRevenue).toBe(500_000);
    expect(stats.paidOrders).toBe(3);
  });

  it('loại đơn huỷ và trả hàng khỏi doanh thu', async () => {
    await service.getStats();

    expect(prisma.order.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          paymentStatus: {
            in: [
              PaymentStatus.PAID,
              PaymentStatus.PARTIALLY_REFUNDED,
              PaymentStatus.REFUNDED,
              PaymentStatus.COD_COLLECTED,
            ],
          },
          status: {
            notIn: [
              OrderStatus.CANCELLED,
              OrderStatus.RETURNED,
              OrderStatus.EXPIRED,
              OrderStatus.FAILED,
            ],
          },
        },
      }),
    );
  });
});
