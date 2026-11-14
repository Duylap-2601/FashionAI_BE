import { PaymentStatus, RefundStatus, UserTier } from '@prisma/client';
import { SubscriptionService } from '../../src/modules/payments/subscription.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

function paidSubscriptionOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-sub',
    orderCode: 87654321,
    userId: 'user-1',
    targetTier: UserTier.MEMBER,
    amount: 34000,
    amountPaidVnd: BigInt(34000),
    ...overrides,
  };
}

/**
 * tx giả lập được cả hai kiểu dùng: gọi trực tiếp revokeEntitlementForRefundedOrder
 * hoặc chạy bên trong $transaction của PaymentsService. `activeAfterCancel` mô
 * phỏng dòng ACTIVE còn lại sau khi các dòng của đơn bị hủy.
 */
function createTx(options: {
  refundedVnd: bigint;
  rows: Array<Record<string, unknown>>;
  activeAfterCancel?: Record<string, unknown> | null;
}) {
  const tx: any = {
    refund: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountVnd: options.refundedVnd } }) },
    subscription: {
      findMany: jest.fn().mockResolvedValue(options.rows),
      findFirst: jest.fn().mockResolvedValue(options.activeAfterCancel ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { update: jest.fn().mockResolvedValue({}) },
  };
  return tx;
}

describe('SubscriptionService.revokeEntitlementForRefundedOrder', () => {
  function createService() {
    const notifications = { create: jest.fn().mockResolvedValue({}) };
    const service = new SubscriptionService({} as any, notifications as any);
    return { service, notifications };
  }

  it('hoàn toàn bộ đơn gói thành viên: hủy gói và hạ user về FREE', async () => {
    const { service } = createService();
    const tx = createTx({
      refundedVnd: BigInt(34000),
      rows: [
        {
          id: 'sub-1',
          orderId: 'order-sub',
          status: 'ACTIVE',
          tier: UserTier.MEMBER,
          startsAt: daysFromNow(-10),
          expiresAt: daysFromNow(20),
        },
      ],
    });

    const result = await service.revokeEntitlementForRefundedOrder(
      tx,
      paidSubscriptionOrder() as any,
    );

    expect(result).toMatchObject({
      userId: 'user-1',
      tier: UserTier.FREE,
      tierExpiresAt: null,
      cancelledSubscriptionIds: ['sub-1'],
    });
    expect(tx.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', status: 'ACTIVE' },
      data: { status: 'CANCELLED', autoRenew: false },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { tier: UserTier.FREE, tierExpiresAt: null },
    });
  });

  it('còn gói ACTIVE khác thì giữ đúng gói đó, không hạ về FREE', async () => {
    const { service } = createService();
    const otherExpiry = daysFromNow(12);
    const tx = createTx({
      refundedVnd: BigInt(34000),
      rows: [
        {
          id: 'sub-1',
          orderId: 'order-sub',
          status: 'ACTIVE',
          tier: UserTier.MEMBER,
          startsAt: daysFromNow(-10),
          expiresAt: daysFromNow(20),
        },
      ],
      activeAfterCancel: {
        id: 'sub-vip',
        orderId: 'order-vip',
        status: 'ACTIVE',
        tier: UserTier.VIP,
        startsAt: daysFromNow(-2),
        expiresAt: otherExpiry,
      },
    });

    const result = await service.revokeEntitlementForRefundedOrder(
      tx,
      paidSubscriptionOrder() as any,
    );

    expect(result).toMatchObject({ tier: UserTier.VIP, tierExpiresAt: otherExpiry });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { tier: UserTier.VIP, tierExpiresAt: otherExpiry },
    });
  });

  it('hoàn một phần thì không thu hồi gì', async () => {
    const { service } = createService();
    const tx = createTx({ refundedVnd: BigInt(10000), rows: [] });

    await expect(
      service.revokeEntitlementForRefundedOrder(tx, paidSubscriptionOrder() as any),
    ).resolves.toBeNull();

    expect(tx.subscription.updateMany).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('đơn sản phẩm (không có targetTier) thì bỏ qua hoàn toàn', async () => {
    const { service } = createService();
    const tx = createTx({ refundedVnd: BigInt(350000), rows: [] });

    await expect(
      service.revokeEntitlementForRefundedOrder(tx, {
        ...paidSubscriptionOrder(),
        targetTier: null,
        amount: 350000,
        amountPaidVnd: BigInt(350000),
      } as any),
    ).resolves.toBeNull();

    // Không tốn query nào cho đơn không phải gói thành viên.
    expect(tx.refund.aggregate).not.toHaveBeenCalled();
  });

  it('idempotent: lần chốt refund thứ hai không sửa lại state', async () => {
    const { service } = createService();
    const tx = createTx({
      refundedVnd: BigInt(34000),
      // Dòng của đơn đã bị hủy ở lần thu hồi trước.
      rows: [
        {
          id: 'sub-1',
          orderId: 'order-sub',
          status: 'CANCELLED',
          tier: UserTier.MEMBER,
          startsAt: daysFromNow(-40),
          expiresAt: daysFromNow(-10),
        },
      ],
    });

    await expect(
      service.revokeEntitlementForRefundedOrder(tx, paidSubscriptionOrder() as any),
    ).resolves.toBeNull();

    expect(tx.subscription.updateMany).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('hoàn đơn gia hạn: lùi hạn dòng ACTIVE về mốc bắt đầu của dòng RENEWED', async () => {
    const { service } = createService();
    // Kỳ trước còn 5 ngày, gia hạn cộng thêm 30 nên dòng ACTIVE kết thúc ở +35.
    const previousCycleEnd = daysFromNow(5);
    const extendedEnd = daysFromNow(35);
    const tx = createTx({
      refundedVnd: BigInt(34000),
      rows: [
        {
          id: 'sub-renewed',
          orderId: 'order-renewal',
          status: 'RENEWED',
          tier: UserTier.MEMBER,
          startsAt: previousCycleEnd,
          expiresAt: extendedEnd,
        },
      ],
      activeAfterCancel: {
        id: 'sub-active',
        orderId: 'order-first',
        status: 'ACTIVE',
        tier: UserTier.MEMBER,
        startsAt: daysFromNow(-25),
        expiresAt: extendedEnd,
      },
    });

    const result = await service.revokeEntitlementForRefundedOrder(tx, {
      ...paidSubscriptionOrder(),
      id: 'order-renewal',
    } as any);

    // Phần 30 ngày vừa cộng bị cắt, quyền lợi còn lại thu về mốc startsAt.
    expect(result?.tier).toBe(UserTier.MEMBER);
    expect(result?.tierExpiresAt).toEqual(previousCycleEnd);
    expect(tx.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-active', status: 'ACTIVE' },
      data: { expiresAt: previousCycleEnd },
    });
    const userUpdate = tx.user.update.mock.calls[0][0];
    expect(userUpdate.data.tier).toBe(UserTier.MEMBER);
  });

  it('hoàn đơn nâng cấp: khôi phục gói cũ còn hạn thay vì đẩy khách về FREE', async () => {
    const { service } = createService();
    const previousCycleEnd = daysFromNow(8);
    const tx = createTx({ refundedVnd: BigInt(33000), rows: [] });
    // Không còn dòng ACTIVE sau khi hủy dòng VIP vừa nâng cấp; gói MEMBER cũ
    // đã bị đóng lúc upgrade nhưng vẫn còn hạn nên phải được bật lại.
    tx.subscription.findFirst.mockImplementation(async (args: any) =>
      args?.where?.status === 'CANCELLED'
        ? {
            id: 'sub-old-member',
            orderId: 'order-old-member',
            status: 'CANCELLED',
            tier: UserTier.MEMBER,
            startsAt: daysFromNow(-22),
            expiresAt: previousCycleEnd,
          }
        : null,
    );
    // Dòng VIP của đơn vừa hoàn là dòng duy nhất mang orderId này.
    tx.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-vip',
        orderId: 'order-upgrade',
        status: 'ACTIVE',
        tier: UserTier.VIP,
        startsAt: daysFromNow(-2),
        expiresAt: previousCycleEnd,
      },
    ]);

    const result = await service.revokeEntitlementForRefundedOrder(tx, {
      ...paidSubscriptionOrder(),
      id: 'order-upgrade',
      targetTier: UserTier.VIP,
      amount: 33000,
      amountPaidVnd: BigInt(33000),
    } as any);

    expect(result).toMatchObject({
      tier: UserTier.MEMBER,
      tierExpiresAt: previousCycleEnd,
    });
    expect(tx.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-old-member', status: 'CANCELLED' },
      data: { status: 'ACTIVE', autoRenew: true },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { tier: UserTier.MEMBER, tierExpiresAt: previousCycleEnd },
    });
  });
});

describe('PaymentsService – hoàn tiền đơn gói thành viên phải thu hồi gói', () => {
  function createPrisma(overrides: Record<string, any>) {
    const prisma: any = {
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountVnd: BigInt(34000) } }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      subscription: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sub-1',
            orderId: 'order-sub',
            status: 'ACTIVE',
            tier: UserTier.MEMBER,
            startsAt: daysFromNow(-10),
            expiresAt: daysFromNow(20),
          },
        ]),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { update: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue(null) },
      order: { update: jest.fn().mockResolvedValue({}) },
      payment: { update: jest.fn().mockResolvedValue({}) },
      orderEvent: { create: jest.fn().mockResolvedValue({}) },
      ...overrides,
    };
    prisma.$transaction = jest.fn((fn: (tx: any) => any) => fn(prisma));
    return prisma;
  }

  function createService(prisma: any) {
    const notifications = { create: jest.fn().mockResolvedValue({}) };
    const subscriptionService = new SubscriptionService(prisma, notifications as any);
    const service = new PaymentsService(
      { get: jest.fn() } as any,
      prisma,
      { sendRefundCompletedEmail: jest.fn().mockResolvedValue(undefined) } as any,
      notifications as any,
      subscriptionService,
      { has: jest.fn(() => true), resolve: jest.fn() } as any,
      { acquireLock: jest.fn().mockResolvedValue(true), releaseLock: jest.fn() } as any,
      {} as any,
      { enqueueEvent: jest.fn().mockResolvedValue({}) } as any,
    );
    return { service, notifications };
  }

  it('finalizeGatewayRefund hoàn toàn bộ: hạ tier và báo cho khách trong cùng luồng', async () => {
    const refundRow = {
      id: 'refund-1',
      orderId: 'order-sub',
      paymentId: 'pay-1',
      provider: 'ZALOPAY',
      amountVnd: BigInt(34000),
      status: RefundStatus.PROCESSING,
      metadata: null,
      payment: {
        id: 'pay-1',
        paymentData: null,
        amountVnd: BigInt(34000),
        order: {
          id: 'order-sub',
          orderCode: 87654321,
          userId: 'user-1',
          targetTier: UserTier.MEMBER,
          amount: 34000,
          amountPaidVnd: BigInt(34000),
        },
      },
    };
    const prisma = createPrisma({
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountVnd: BigInt(34000) } }),
        findUnique: jest.fn().mockResolvedValue(refundRow),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const { service, notifications } = createService(prisma);

    const result = await service['finalizeGatewayRefund']('refund-1', 'COMPLETED', {});

    expect(result?.claimed).toBe(true);
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', status: 'ACTIVE' },
      data: { status: 'CANCELLED', autoRenew: false },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { tier: UserTier.FREE, tierExpiresAt: null },
    });
    // Thông báo hoàn tiền + thông báo thu hồi gói.
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SYSTEM', title: 'Gói thành viên đã bị thu hồi' }),
    );
  });

  it('hoàn một phần thì không đụng tới gói', async () => {
    const refundRow = {
      id: 'refund-1',
      orderId: 'order-sub',
      paymentId: 'pay-1',
      provider: 'ZALOPAY',
      amountVnd: BigInt(10000),
      status: RefundStatus.PROCESSING,
      metadata: null,
      payment: {
        id: 'pay-1',
        paymentData: null,
        amountVnd: BigInt(34000),
        order: {
          id: 'order-sub',
          orderCode: 87654321,
          userId: 'user-1',
          targetTier: UserTier.MEMBER,
          amount: 34000,
          amountPaidVnd: BigInt(34000),
        },
      },
    };
    const prisma = createPrisma({
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountVnd: BigInt(10000) } }),
        findUnique: jest.fn().mockResolvedValue(refundRow),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const { service, notifications } = createService(prisma);

    await service['finalizeGatewayRefund']('refund-1', 'COMPLETED', {});

    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Gói thành viên đã bị thu hồi' }),
    );
  });

  it('payment thu trùng (refundScope PAYMENT_ONLY) không cắt gói dù đơn là đơn gói', async () => {
    const refundRow = {
      id: 'refund-3',
      orderId: 'order-sub',
      paymentId: 'pay-3',
      provider: 'ZALOPAY',
      amountVnd: BigInt(34000),
      status: RefundStatus.PROCESSING,
      metadata: null,
      payment: {
        id: 'pay-3',
        paymentData: { refundScope: 'PAYMENT_ONLY', collectedAmountVnd: 34000 },
        amountVnd: BigInt(34000),
        order: {
          id: 'order-sub',
          orderCode: 87654321,
          userId: 'user-1',
          targetTier: UserTier.MEMBER,
          amount: 34000,
          amountPaidVnd: BigInt(34000),
        },
      },
    };
    const prisma = createPrisma({
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountVnd: BigInt(34000) } }),
        findUnique: jest.fn().mockResolvedValue(refundRow),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const { service } = createService(prisma);

    await service['finalizeGatewayRefund']('refund-3', 'COMPLETED', {});

    // Khoản thu trùng không mua gói nào nên quyền lợi phải được giữ nguyên.
    expect(prisma.subscription.findMany).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('hoàn đơn sản phẩm qua finalizeGatewayRefund không chạm bảng gói', async () => {
    const refundRow = {
      id: 'refund-2',
      orderId: 'order-product',
      paymentId: 'pay-2',
      provider: 'ZALOPAY',
      amountVnd: BigInt(350000),
      status: RefundStatus.PROCESSING,
      metadata: null,
      payment: {
        id: 'pay-2',
        paymentData: null,
        amountVnd: BigInt(350000),
        order: {
          id: 'order-product',
          orderCode: 12345678,
          userId: 'user-1',
          targetTier: null,
          amount: 350000,
          amountPaidVnd: BigInt(350000),
        },
      },
    };
    const prisma = createPrisma({
      refund: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountVnd: BigInt(350000) } }),
        findUnique: jest.fn().mockResolvedValue(refundRow),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const { service } = createService(prisma);

    const result = await service['finalizeGatewayRefund']('refund-2', 'COMPLETED', {});

    expect(result?.claimed).toBe(true);
    expect(prisma.subscription.findMany).not.toHaveBeenCalled();
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('refundGatewayPayment SUCCESS đồng bộ cũng thu hồi gói', async () => {
    const order = {
      id: 'order-sub',
      orderCode: 87654321,
      userId: 'user-1',
      targetTier: UserTier.MEMBER,
      amount: 34000,
      amountPaidVnd: BigInt(34000),
      paymentStatus: PaymentStatus.PAID,
    };
    const payment = {
      id: 'pay-1',
      orderId: 'order-sub',
      provider: 'ZALOPAY',
      status: PaymentStatus.PAID,
      transactionId: 'zp-tx-1',
      amountVnd: BigInt(34000),
      paymentData: null,
      order,
    };
    const prisma: any = {
      refund: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'refund-1',
          orderId: 'order-sub',
          paymentId: 'pay-1',
          provider: 'ZALOPAY',
          providerRefundId: 'rf-1',
          amountVnd: BigInt(34000),
          currency: 'VND',
          reason: null,
          status: RefundStatus.PENDING,
          idempotencyKey: 'idem-1',
          requestedAt: new Date(),
          processedAt: null,
          failedReason: null,
          metadata: null,
        }),
        update: jest.fn(async ({ data }: any) => ({
          id: 'refund-1',
          orderId: 'order-sub',
          paymentId: 'pay-1',
          provider: 'ZALOPAY',
          providerRefundId: 'rf-1',
          amountVnd: BigInt(34000),
          currency: 'VND',
          reason: null,
          status: data.status,
          idempotencyKey: 'idem-1',
          requestedAt: new Date(),
          processedAt: data.processedAt ?? null,
          failedReason: null,
          metadata: null,
        })),
        // Lượt 1 (check số dư) là 0, lượt 2 (tổng đã hoàn của payment/order) là toàn bộ.
        aggregate: jest
          .fn()
          .mockResolvedValueOnce({ _sum: { amountVnd: BigInt(0) } })
          .mockResolvedValueOnce({ _sum: { amountVnd: BigInt(34000) } })
          .mockResolvedValueOnce({ _sum: { amountVnd: BigInt(34000) } })
          .mockResolvedValue({ _sum: { amountVnd: BigInt(34000) } }),
      },
      payment: {
        findUnique: jest.fn().mockResolvedValue(payment),
        update: jest.fn().mockResolvedValue({}),
      },
      order: { update: jest.fn().mockResolvedValue({}) },
      orderEvent: { create: jest.fn().mockResolvedValue({}) },
      subscription: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sub-1',
            orderId: 'order-sub',
            status: 'ACTIVE',
            tier: UserTier.MEMBER,
            startsAt: daysFromNow(-10),
            expiresAt: daysFromNow(20),
          },
        ]),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { update: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue(null) },
    };
    prisma.$transaction = jest.fn((fn: (tx: any) => any) => fn(prisma));

    const gateway = {
      code: 'ZALOPAY',
      buildRefundId: jest.fn(() => 'rf-1'),
      refund: jest.fn().mockResolvedValue({ status: 'SUCCESS', raw: { return_code: 1 } }),
    };
    const notifications = { create: jest.fn().mockResolvedValue({}) };
    const service = new PaymentsService(
      { get: jest.fn() } as any,
      prisma,
      { sendRefundCompletedEmail: jest.fn().mockResolvedValue(undefined) } as any,
      notifications as any,
      new SubscriptionService(prisma, notifications as any),
      { has: jest.fn(() => true), resolve: jest.fn(() => gateway) } as any,
      { acquireLock: jest.fn().mockResolvedValue(true), releaseLock: jest.fn() } as any,
      {} as any,
      { enqueueEvent: jest.fn().mockResolvedValue({}) } as any,
    );

    await service.refundGatewayPayment(
      'pay-1',
      { amountVnd: 34000, reason: 'Khách báo lỗi', idempotencyKey: 'idem-1' } as any,
      'admin-1',
    );

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', status: 'ACTIVE' },
      data: { status: 'CANCELLED', autoRenew: false },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { tier: UserTier.FREE, tierExpiresAt: null },
    });
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SYSTEM', title: 'Gói thành viên đã bị thu hồi' }),
    );
  });
});
