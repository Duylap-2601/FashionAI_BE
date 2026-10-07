import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';
import request from 'supertest';
import { OrderStatus, PaymentStatus, UserTier } from '@prisma/client';
import { PaymentsController } from '../../src/modules/payments/payments.controller';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { SubscriptionService } from '../../src/modules/payments/subscription.service';
import { MailQueueService } from '../../src/modules/mail/mail-queue.service';
import { NotificationService } from '../../src/modules/notification/notification.service';
import { OutboxService } from '../../src/modules/outbox/services/outbox.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '../../src/common/guards/rate-limit.guard';
import {
  createPrismaMock,
  createTestApp,
  PrismaMock,
} from './helpers/test-app';

const IPN_SECRET = 'test-ipn-secret';
const WEBHOOK_SECRET = 'test-webhook-secret';

// Stub ConfigService để spec hermetic: không phụ thuộc giá trị thật trong `.env`
// (ConfigModule sẽ merge `.env` đè lên `load`, ví dụ SEPAY_WEBHOOK_SECRET thật).
const TEST_CONFIG: Record<string, string> = {
  NODE_ENV: 'test',
  SEPAY_IPN_SECRET: IPN_SECRET,
  SEPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

describe('SePay IPN (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock();
    // processOrderSuccess chốt trạng thái bằng updateMany({..., status: CREATED, paymentStatus: PENDING}),
    // nên mock phải báo đúng 1 row được claim mới đi tiếp vào các bước ghi.
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    const created = await createTestApp({
      prisma,
      metadata: {
        imports: [],
        controllers: [PaymentsController],
        providers: [
          PaymentsService,
          SubscriptionService,
          { provide: ConfigService, useValue: { get: (key: string, fallback?: string) => TEST_CONFIG[key] ?? fallback } },
          {
            provide: MailQueueService,
            useValue: {
              sendOrderConfirmationEmail: jest.fn().mockResolvedValue(undefined),
              sendRenewalReminderEmail: jest.fn().mockResolvedValue(undefined),
            },
          },
          { provide: NotificationService, useValue: { create: jest.fn().mockResolvedValue({}) } },
          { provide: OutboxService, useValue: { enqueueEvent: jest.fn().mockResolvedValue({}) } },
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
    await app?.close();
  });

  const pendingProductOrder = {
    id: 'order-1',
    orderCode: 12345678,
    userId: 'user-1',
    targetTier: null,
    amount: 350000,
    status: OrderStatus.CREATED,
    paymentStatus: PaymentStatus.PENDING,
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

  function postBank(payload: unknown) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(payload);
    const signature = `sha256=${crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex')}`;
    return request(app.getHttpServer())
      .post('/api/payments/sepay-webhook')
      .set('x-sepay-timestamp', timestamp)
      .set('x-sepay-signature', signature)
      .set('Content-Type', 'application/json')
      .send(rawBody);
  }

  it('đánh dấu thanh toán đơn sản phẩm và chuyển sang PROCESSING mà không đổi tier', async () => {
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
      amount: 49000,
    });

    await post(orderPaidPayload(49000)).expect(200);

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

  it('idempotent: đơn đã thanh toán không xử lý lại', async () => {
    prisma.order.findUnique.mockResolvedValue({
      ...pendingProductOrder,
      status: OrderStatus.PROCESSING,
      paymentStatus: PaymentStatus.PAID,
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

  it('chấp nhận IPN ký bằng X-Secret-Key (auth type SECRET_KEY)', async () => {
    prisma.order.findUnique.mockResolvedValue(pendingProductOrder);

    await request(app.getHttpServer())
      .post('/api/payments/sepay-ipn')
      .set('X-Secret-Key', IPN_SECRET)
      .send(orderPaidPayload())
      .expect(200);

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('từ chối khi X-Secret-Key sai', async () => {
    prisma.order.findUnique.mockResolvedValue(pendingProductOrder);

    await request(app.getHttpServer())
      .post('/api/payments/sepay-ipn')
      .set('X-Secret-Key', 'wrong-secret')
      .send(orderPaidPayload())
      .expect(400);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('bank webhook giao dịch lạ (memo PAY... không có FAI)', () => {
    const unmatchedPayload = {
      id: 86449921,
      gateway: 'MBBank',
      transactionDate: '2026-10-02 21:40:53',
      accountNumber: '0345986537',
      subAccount: '',
      code: null,
      content: 'IBFT PAY40146ABFC27572D82',
      transferType: 'in',
      transferAmount: 34000,
      referenceCode: 'FT24012345678',
    };

    it('trả 200 để SePay không retry, không đổi trạng thái đơn nào', async () => {
      const res = await postBank(unmatchedPayload).expect(200);

      expect(res.body.success).toBe(true);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('vẫn match đơn khi content có FAI<orderCode>', async () => {
      prisma.order.findUnique.mockResolvedValue(pendingProductOrder);

      await postBank({ ...unmatchedPayload, content: 'FAI12345678 thanh toan', transferAmount: 350000 }).expect(200);

      expect(prisma.$transaction).toHaveBeenCalled();
    });
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
    it('đánh dấu đơn CREATED là PAID', async () => {
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
