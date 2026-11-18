import { SubscriptionService } from '../../src/modules/payments/subscription.service';

describe('SubscriptionService.getSubscriptionHistory – phân trang', () => {
  const buildService = () => {
    const prisma: any = {
      subscription: {
        findMany: jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
        count: jest.fn().mockResolvedValue(25),
      },
    };
    const notificationService: any = { create: jest.fn().mockResolvedValue({}) };
    return { service: new SubscriptionService(prisma, notificationService), prisma };
  };

  it('TC-203: mới nhất trước, skip/take theo page/limit, meta đủ field', async () => {
    const { service, prisma } = buildService();

    const result = await service.getSubscriptionHistory('user-1', 2, 10);

    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
      }),
    );
    expect(result.meta).toEqual({ total: 25, page: 2, limit: 10, totalPages: 3 });
  });

  it('TC-203: limit bị kẹp về 1..100', async () => {
    const { service, prisma } = buildService();

    await service.getSubscriptionHistory('user-1', 1, 1000);
    expect(prisma.subscription.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 100 }),
    );

    await service.getSubscriptionHistory('user-1', 1, 0);
    expect(prisma.subscription.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 1 }),
    );
  });
});

describe('SubscriptionService.findSubscriptionsDueForRenewal – điều kiện nhắc', () => {
  const buildService = () => {
    const prisma: any = {
      subscription: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { service: new SubscriptionService(prisma, { create: jest.fn() } as any), prisma };
  };

  it('TC-219: chỉ ACTIVE + autoRenew + chưa nhắc + hết hạn trong N ngày + không có SCHEDULED', async () => {
    const { service, prisma } = buildService();

    await service.findSubscriptionsDueForRenewal(3);

    const where = prisma.subscription.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      status: 'ACTIVE',
      autoRenew: true,
      renewalReminderSentAt: null,
      expiresAt: { gte: expect.any(Date), lte: expect.any(Date) },
      user: { subscriptions: { none: { status: 'SCHEDULED' } } },
    });
    // Cửa sổ = now + 3 ngày.
    const windowDays = Math.round(
      (where.expiresAt.lte.getTime() - where.expiresAt.gte.getTime()) / (24 * 60 * 60 * 1000),
    );
    expect(windowDays).toBe(3);
  });
});
