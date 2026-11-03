import { BadRequestException } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { PaymentsService } from '../../src/modules/payments/payments.service';

// Lần thanh toán ZaloPay còn chờ của một đơn 570.900đ (vd. QR khách chưa quét,
// đơn đã được admin xác nhận chuyển khoản thủ công).
const pendingPayment = {
  id: 'pay-zalopay',
  orderId: 'order-1',
  provider: 'ZALOPAY',
  providerPaymentId: '261103_59919925',
  idempotencyKey: 'req-1',
  amountVnd: BigInt(570_900),
  status: PaymentStatus.PENDING,
  paymentData: null,
  order: { id: 'order-1', orderCode: 59919925, amount: 570_900, status: OrderStatus.MEASUREMENT_REVIEW, paymentStatus: PaymentStatus.PAID },
};

function setup() {
  const prisma: any = {
    payment: {
      findFirst: jest.fn().mockResolvedValue(pendingPayment),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    webhookEvent: { create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
    webhookFailure: { create: jest.fn().mockResolvedValue({}) },
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const service = new PaymentsService(
    {} as any, prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  const gateway = { code: 'ZALOPAY' } as any;
  return { service, prisma, gateway };
}

describe('applyGatewayPaymentResult', () => {
  it('ZaloPay báo thất bại/hết hạn (amount = 0): đánh dấu FAILED, không báo lệch số tiền', async () => {
    const { service, prisma, gateway } = setup();

    await expect(
      service['applyGatewayPaymentResult'](gateway, {
        providerOrderId: pendingPayment.providerPaymentId,
        amountVnd: 0,
        status: 'FAILED',
        eventKey: `ZALOPAY:${pendingPayment.providerPaymentId}:FAILED`,
        failureReason: 'Giao dịch hết hạn',
        raw: { return_code: 2 },
      }, 'QUERY'),
    ).resolves.toBe('OK');

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pay-zalopay', status: PaymentStatus.PENDING },
      data: expect.objectContaining({ status: PaymentStatus.FAILED, failureReason: 'Giao dịch hết hạn' }),
    }));
    expect(prisma.webhookFailure.create).not.toHaveBeenCalled();
  });

  it('ZaloPay báo đã thu nhưng sai số tiền: vẫn chặn và gắn cờ cần hoàn tiền', async () => {
    const { service, prisma, gateway } = setup();

    await expect(
      service['applyGatewayPaymentResult'](gateway, {
        providerOrderId: pendingPayment.providerPaymentId,
        amountVnd: 100_000,
        status: 'SUCCESS',
        transactionId: 'zp-tx-1',
        eventKey: 'ZALOPAY:261103_59919925:zp-tx-1',
        raw: { return_code: 1 },
      }, 'CALLBACK'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: PaymentStatus.REFUND_REQUIRED, failureReason: 'AMOUNT_MISMATCH' }),
    }));
    expect(prisma.webhookFailure.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reason: 'AMOUNT_MISMATCH' }),
    }));
  });
});
