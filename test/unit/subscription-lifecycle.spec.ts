import { PaymentStatus, UserTier } from '@prisma/client';
import { SubscriptionService } from '../../src/modules/payments/subscription.service';
import { SUBSCRIPTION_DURATION_DAYS } from '../../src/common/constants/subscription-plans.constants';

const DAY_MS = 24 * 60 * 60 * 1000;
const days = (n: number) => new Date(Date.now() + n * DAY_MS);

interface SubscriptionRow {
  id: string;
  status: string;
  tier: UserTier;
  orderId: string;
  autoRenew: boolean;
  startsAt: Date;
  expiresAt: Date;
  createdAt: Date;
}

function row(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 'sub-active',
    status: 'ACTIVE',
    tier: UserTier.MEMBER,
    orderId: 'order-first',
    autoRenew: true,
    startsAt: days(-10),
    expiresAt: days(20),
    createdAt: days(-10),
    ...overrides,
  };
}

function createPrisma(activeRow: SubscriptionRow | null) {
  const prisma: any = {
    subscription: {
      findFirst: jest.fn((args: any) =>
        Promise.resolve(args?.where?.status === 'ACTIVE' ? activeRow : null),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: any) => ({ id: 'sub-new', ...data })),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: { update: jest.fn().mockResolvedValue({}) },
  };
  return prisma;
}

function createService(prisma: any) {
  const notifications = { create: jest.fn().mockResolvedValue({}) };
  return { service: new SubscriptionService(prisma, notifications as any), notifications };
}

describe('SubscriptionService.createOrExtendSubscription – gia hạn cộng dồn tại chỗ', () => {
  it('RENEWAL cộng 30 ngày vào dòng ACTIVE hiện tại và ghi vết đơn mới bằng RENEWED', async () => {
    const active = row({ expiresAt: days(10) });
    const prisma = createPrisma(active);
    const { service } = createService(prisma);

    const result = await service.createOrExtendSubscription('user-1', UserTier.MEMBER, {
      id: 'order-renewal',
      amount: 34000,
      createdAt: new Date(),
    });

    expect(result.mode).toBe('RENEWAL');
    // Không tạo thêm dòng ACTIVE (partial unique index chỉ cho một dòng/user).
    expect(prisma.subscription.create).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'RENEWED', orderId: 'order-renewal' }),
    });
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-active', status: 'ACTIVE' },
      data: { expiresAt: new Date(active.expiresAt.getTime() + SUBSCRIPTION_DURATION_DAYS * DAY_MS), autoRenew: true },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        tier: UserTier.MEMBER,
        tierExpiresAt: new Date(active.expiresAt.getTime() + SUBSCRIPTION_DURATION_DAYS * DAY_MS),
      },
    });
  });

  it('RENEWAL giữ orderId gốc trên dòng ACTIVE, không ghi đè sang đơn mới', async () => {
    const active = row();
    const prisma = createPrisma(active);
    const { service } = createService(prisma);

    await service.createOrExtendSubscription('user-1', UserTier.MEMBER, {
      id: 'order-renewal',
      amount: 34000,
      createdAt: new Date(),
    });

    // Điều kiện của updateMany chỉ trỏ đúng id -> dòng ACTIVE giữ nguyên orderId.
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sub-active', status: 'ACTIVE' } }),
    );
    expect(prisma.subscription.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderId: 'order-renewal' }) }),
    );
  });
});

describe('SubscriptionService.createOrExtendSubscription – kiểm tra lại quote proration', () => {
  function upgradeOrder(overrides: Record<string, unknown> = {}) {
    return {
      id: 'order-upgrade',
      orderCode: 11112222,
      amount: 33000,
      prorationSnapshot: { oldTier: 'MEMBER', newTier: 'VIP', remainingDays: 15, credit: 17000, debit: 50000, net: 33000 },
      createdAt: new Date(),
      ...overrides,
    };
  }

  it('quote còn hiệu lực: giữ nguyên ngày hết hạn của chu kỳ đã trả tiền', async () => {
    const active = row({ expiresAt: days(15) });
    const prisma = createPrisma(active);
    const { service } = createService(prisma);

    const result = await service.createOrExtendSubscription(
      'user-1',
      UserTier.VIP,
      upgradeOrder() as any,
    );

    expect(result.mode).toBe('UPGRADE');
    const created = prisma.subscription.create.mock.calls[0][0].data;
    expect(created.status).toBe('ACTIVE');
    expect(created.tier).toBe(UserTier.VIP);
    // Không reset về now + 30 ngày.
    expect(created.expiresAt).toEqual(active.expiresAt);
  });

  it('quote cũ vì gói hiện tại đã hết hạn: cấp số ngày tương ứng số tiền đã trả, không tặng 30 ngày', async () => {
    // Dòng ACTIVE đã quá hạn -> mode NEW, và quote proration chỉ được cấp theo
    // số tiền: 33000/99000 * 30 = 10 ngày.
    const active = row({ expiresAt: days(-1) });
    const prisma = createPrisma(active);
    const { service } = createService(prisma);

    const result = await service.createOrExtendSubscription(
      'user-1',
      UserTier.VIP,
      upgradeOrder() as any,
    );

    expect(result.mode).toBe('NEW');
    const created = prisma.subscription.create.mock.calls[0][0].data;
    const grantedDays = Math.round((created.expiresAt.getTime() - Date.now()) / DAY_MS);
    expect(grantedDays).toBe(10);
    expect(grantedDays).toBeLessThan(SUBSCRIPTION_DURATION_DAYS);
  });

  it('quote cũ vì quá 24h: cấp theo số tiền đã trả thay vì 30 ngày', async () => {
    const active = row({ expiresAt: days(15) });
    const prisma = createPrisma(active);
    const { service } = createService(prisma);

    const result = await service.createOrExtendSubscription(
      'user-1',
      UserTier.VIP,
      upgradeOrder({ createdAt: days(-2) }) as any,
    );

    expect(result.mode).toBe('UPGRADE');
    const created = prisma.subscription.create.mock.calls[0][0].data;
    const grantedDays = Math.round((created.expiresAt.getTime() - Date.now()) / DAY_MS);
    expect(grantedDays).toBe(10);
  });

  it('quote trỏ tới gói khác với gói hiện tại: coi là quote cũ', async () => {
    // Quote tính cho MEMBER -> VIP nhưng user đang ở FREE (ACTIVE lạ) => không khớp.
    const active = row({ tier: UserTier.FREE, expiresAt: days(15) });
    const prisma = createPrisma(active);
    const { service } = createService(prisma);

    await service.createOrExtendSubscription('user-1', UserTier.VIP, upgradeOrder() as any);

    const created = prisma.subscription.create.mock.calls[0][0].data;
    const grantedDays = Math.round((created.expiresAt.getTime() - Date.now()) / DAY_MS);
    expect(grantedDays).toBe(10);
  });

  it('trả đủ giá gói thì ra đúng 30 ngày', async () => {
    const prisma = createPrisma(null);
    const { service } = createService(prisma);

    await service.createOrExtendSubscription('user-1', UserTier.VIP, {
      id: 'order-full',
      amount: 99000,
      prorationSnapshot: null,
      createdAt: new Date(),
    });

    const created = prisma.subscription.create.mock.calls[0][0].data;
    expect(created.expiresAt).toEqual(
      new Date(created.startsAt.getTime() + SUBSCRIPTION_DURATION_DAYS * DAY_MS),
    );
  });

  it('khi dòng ACTIVE cũ đã hết hạn thì đóng nó trước khi tạo dòng ACTIVE mới', async () => {
    const active = row({ expiresAt: days(-1), autoRenew: true });
    const prisma = createPrisma(active);
    const { service } = createService(prisma);

    await service.createOrExtendSubscription('user-1', UserTier.VIP, {
      id: 'order-new',
      amount: 99000,
      createdAt: new Date(),
    });

    // Dòng ACTIVE cũ chiếm suất ACTIVE trong partial unique index -> đóng thành EXPIRED.
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-active', status: 'ACTIVE' },
      data: { status: 'EXPIRED', autoRenew: false },
    });
  });
});

describe('SubscriptionService.expireSubscriptions', () => {
  function createExpirePrisma(scheduled: Array<Record<string, unknown>>) {
    const prisma: any = {
      subscription: {
        findMany: jest.fn().mockResolvedValue(scheduled),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    return prisma;
  }

  it('Step A kích hoạt lịch hẹn bằng đúng expiresAt đã chốt, không cộng lại 30 ngày', async () => {
    const storedExpiry = days(30);
    const prisma = createExpirePrisma([
      {
        id: 'sub-scheduled',
        userId: 'user-1',
        tier: UserTier.MEMBER,
        orderId: 'order-downgrade',
        startsAt: days(-3),
        expiresAt: storedExpiry,
        order: { orderCode: 12345678, paymentStatus: PaymentStatus.PAID },
      },
    ]);
    const { service } = createService(prisma);

    const result = await service.expireSubscriptions();

    expect(result.activatedSubscriptions).toBe(1);
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-scheduled', status: 'SCHEDULED' },
      data: { status: 'ACTIVE' },
    });
    // Không ghi đè expiresAt bằng max(startsAt, now) + 30.
    expect(prisma.subscription.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ expiresAt: expect.anything() }),
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { tier: UserTier.MEMBER, tierExpiresAt: storedExpiry },
    });
  });

  it('Step A bỏ qua lịch hẹn có đơn chưa thanh toán nhưng cron vẫn chạy tiếp', async () => {
    const prisma = createExpirePrisma([
      {
        id: 'sub-unpaid',
        userId: 'user-1',
        tier: UserTier.MEMBER,
        orderId: 'order-unpaid',
        startsAt: days(-3),
        expiresAt: days(27),
        order: { orderCode: 99999999, paymentStatus: PaymentStatus.PENDING },
      },
      {
        id: 'sub-paid',
        userId: 'user-2',
        tier: UserTier.VIP,
        orderId: 'order-paid',
        startsAt: days(-1),
        expiresAt: days(29),
        order: { orderCode: 11111111, paymentStatus: PaymentStatus.PAID },
      },
    ]);
    const { service } = createService(prisma);

    const result = await service.expireSubscriptions();

    expect(result.activatedSubscriptions).toBe(1);
    expect(result.skippedUnpaidSubscriptions).toBe(1);
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-paid', status: 'SCHEDULED' },
      data: { status: 'ACTIVE' },
    });
    expect(prisma.subscription.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'sub-unpaid' }) }),
    );
    expect(prisma.user.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
  });
});
