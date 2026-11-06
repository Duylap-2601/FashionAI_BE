import { BadRequestException } from '@nestjs/common';
import { OrderStatus, PaymentStatus, RefundStatus } from '@prisma/client';
import { OrdersService } from '../../src/modules/orders/orders.service';

const ORDER_ID = '3f2c7c8e-5d5a-4c6b-9d0e-1a2b3c4d5e6f';

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    orderCode: 100001,
    userId: 'user-1',
    status: OrderStatus.RETURNED,
    paymentStatus: PaymentStatus.PAID,
    refundStatus: RefundStatus.REQUIRED,
    amount: 770900,
    amountPaidVnd: BigInt(770900),
    refundEvidence: { receiptImages: ['https://cdn.test/receipt.png'], reference: 'FT2611021234' },
    ...overrides,
  };
}

function createPrisma(order: ReturnType<typeof makeOrder>, gatewayRefunds: unknown[] = []) {
  const prisma: any = {
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      update: jest.fn().mockResolvedValue({}),
    },
    refund: {
      findMany: jest.fn().mockResolvedValue(gatewayRefunds),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountVnd: 0 } }),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'refund-1' }),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
    orderIssue: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  prisma.$transaction = jest.fn((fn: (tx: any) => any) => fn(prisma));
  return prisma;
}

function createService(prisma: any) {
  const notifications = { create: jest.fn().mockResolvedValue({}) };
  const service = new OrdersService(
    prisma,
    {} as any,
    notifications as any,
    {} as any,
    {} as any,
    {} as any,
  );
  (service as any).findOne = jest.fn().mockResolvedValue({ id: ORDER_ID });
  return service;
}

function confirmManualRefund(service: OrdersService) {
  return service.updateRefund(
    ORDER_ID,
    { refundStatus: RefundStatus.COMPLETED, internalNote: 'VCB FT2611021234' },
    'admin-1',
  );
}

describe('OrdersService.updateRefund – chuyển khoản tay cho đơn trả online', () => {
  it('cho phép chốt hoàn tiền khi cổng không có khoản hoàn nào đang chạy', async () => {
    const prisma = createPrisma(makeOrder());
    const service = createService(prisma);

    await expect(confirmManualRefund(service)).resolves.toBeDefined();

    expect(prisma.refund.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: 'MANUAL', status: RefundStatus.COMPLETED }),
      }),
    );
  });

  it('chặn chốt tay khi cổng đang hoàn tiền cho cùng đơn', async () => {
    const prisma = createPrisma(makeOrder(), [
      { status: RefundStatus.PROCESSING, amountVnd: BigInt(770900), payment: { paymentData: null } },
    ]);
    const service = createService(prisma);

    await expect(confirmManualRefund(service)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('khoản hoàn PAYMENT_ONLY (thu trùng) không chặn chuyển khoản tay của đơn', async () => {
    const prisma = createPrisma(makeOrder(), [
      {
        status: RefundStatus.PROCESSING,
        amountVnd: BigInt(770900),
        payment: { paymentData: { refundScope: 'PAYMENT_ONLY' } },
      },
    ]);
    const service = createService(prisma);

    await expect(confirmManualRefund(service)).resolves.toBeDefined();
  });

  it('trừ tiền cổng đã hoàn vào hạn mức còn lại của đơn', async () => {
    const prisma = createPrisma(makeOrder(), [
      { status: RefundStatus.COMPLETED, amountVnd: BigInt(770900), payment: { paymentData: null } },
    ]);
    const service = createService(prisma);

    await expect(confirmManualRefund(service)).rejects.toThrow(
      'Không còn số tiền nào để hoàn cho đơn hàng này.',
    );
    expect(prisma.refund.create).not.toHaveBeenCalled();
  });
});
