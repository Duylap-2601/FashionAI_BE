import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import crypto from 'crypto';
import request from 'supertest';
import { OrderStatus, UserTier } from '@prisma/client';
import { PaymentsController } from '../../src/modules/payments/payments.controller';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { SubscriptionService } from '../../src/modules/payments/subscription.service';
import { MailService } from '../../src/modules/mail/mail.service';
import { NotificationService } from '../../src/modules/notification/notification.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '../../src/common/guards/rate-limit.guard';
import {
  createPrismaMock,
  createTestApp,
  PrismaMock,
} from './helpers/test-app';

const IPN_SECRET = 'test-ipn-secret';

describe('SePay IPN (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock();
    // processOrderSuccess chốt trạng thái bằng updateMany({..., status: PENDING}),
    // nên mock phải báo đúng 1 row được claim mới đi tiếp vào các bước ghi.
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    const created = await createTestApp({
      prisma,
      metadata: {
        imports: [
          ConfigModule.forRoot({
            load: [
              () => ({
                NODE_ENV: 'test',
                SEPAY_IPN_SECRET: IPN_SECRET,
              }),
            ],
          }),
        ],
        controllers: [PaymentsController],
        providers: [
          PaymentsService,
          SubscriptionService,
          MailService,
          { provide: NotificationService, useValue: { create: jest.fn().mockResolvedValue({}) } },
        ],
      },
      configure: (builder) =>
        builder
          .overrideGuard(JwtAuthGuard)
          .useValue({ canActivate: () => true })
          .overrideGuard(RateLimitGuard)
          .useValue({ canActivate: () => true }),
    });

    app = created.app;
  });

  afterEach(async () => {
    await app.close();
  });

  const pendingProductOrder = {
    id: 'order-1',
    orderCode: 12345678,
    userId: 'user-1',
    targetTier: null,
    amount: 350000,
    status: OrderStatus.PENDING,
  };

  function orderPaidPayload(amount = 350000) {
    return {
      notification_type: 'ORDER_PAID',
      order: {
        order_invoice_number: 'FAI12345678',
        order_amount: amount,
      },
      transaction: {
        transaction_id: 'sepay-tx-1',
        transaction_amount: amount,
      },
    };
  }

  function post(payload: unknown, signingSecret: string | null = IPN_SECRET) {
    const req = request(app.getHttpServer()).post('/api/payments/sepay-ipn');
    if (signingSecret !== null) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const rawBody = JSON.stringify(payload);
      const signature = `sha256=${crypto
        .createHmac('sha256', signingSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex')}`;
      req.set('x-sepay-timestamp', timestamp);
      req.set('x-sepay-signature', signature);
      return req.set('Content-Type', 'application/json').send(rawBody);
    }
    return req.send(payload as object);
  }

  it('đánh dấu đơn sản phẩm là PAID mà không đổi tier', async () => {
    prisma.order.findUnique.mockResolvedValue(pendingProductOrder);

    const res = await post(orderPaidPayload()).expect(200);

    expect(res.body.success).toBe(true);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('nâng tier khi đơn là subscription', async () => {
    prisma.order.findUnique.mockResolvedValue({
      ...pendingProductOrder,
      targetTier: UserTier.MEMBER,
      amount: 99000,
    });

    await post(orderPaidPayload(99000)).expect(200);

    expect(prisma.subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          tier: UserTier.MEMBER,
          orderId: 'order-1',
        }),
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tier: UserTier.MEMBER }),
      }),
    );
  });

  it('không trừ tồn kho lần hai khi webhook khác đã chốt đơn', async () => {
    prisma.order.findUnique.mockResolvedValue({
      ...pendingProductOrder,
      items: [{ productId: 'product-1', quantity: 2 }],
    });
    // IPN và bank webhook về gần như đồng thời: cả hai đều đọc thấy PENDING, nhưng
    // chỉ câu UPDATE có điều kiện của webhook đến trước khớp được row.
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    await post(orderPaidPayload()).expect(200);

    expect(prisma.product.update).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('từ chối khi số tiền không khớp đơn hàng', async () => {    prisma.order.findUnique.mockResolvedValue(pendingProductOrder);

    const res = await post(orderPaidPayload(1000)).expect(400);

    expect(res.body.message).toContain('không khớp');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('từ chối khi signature không đúng', async () => {
    prisma.order.findUnique.mockResolvedValue(pendingProductOrder);

    await post(orderPaidPayload(), 'wrong-secret').expect(400);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('không ghi nhận thanh toán cho đơn đã hủy', async () => {
    prisma.order.findUnique.mockResolvedValue({
      ...pendingProductOrder,
      status: OrderStatus.CANCELLED,
    });

    await post(orderPaidPayload()).expect(400);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('idempotent: đơn đã PAID không xử lý lại', async () => {
    prisma.order.findUnique.mockResolvedValue({
      ...pendingProductOrder,
      status: OrderStatus.PAID,
    });

    await post(orderPaidPayload()).expect(200);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('bỏ qua notification không phải ORDER_PAID', async () => {
    await post({
      ...orderPaidPayload(),
      notification_type: 'ORDER_CREATED',
    }).expect(200);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('hủy đơn khi nhận TRANSACTION_VOID', async () => {
    prisma.order.findUnique.mockResolvedValue(pendingProductOrder);

    await post({
      ...orderPaidPayload(),
      notification_type: 'TRANSACTION_VOID',
    }).expect(200);

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  describe('mock-success (chỉ dùng ngoài production)', () => {
    it('đánh dấu đơn PENDING là PAID', async () => {
      prisma.order.findUnique.mockResolvedValue(pendingProductOrder);

      await request(app.getHttpServer())
        .get('/api/payments/mock-success?orderCode=12345678')
        .expect(200);

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('trả 404 khi không tìm thấy đơn', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get('/api/payments/mock-success?orderCode=999')
        .expect(404);
    });
  });
});
