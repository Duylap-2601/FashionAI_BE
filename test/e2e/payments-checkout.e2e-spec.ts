import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

const AUTH_USER = { id: 'user-1', email: 'a@b.com', tier: UserTier.FREE };
const VALID_SHIPPING_SNAPSHOT = {
  address: '123 Nguyen Trai, Phuong 1, Quan 1, TP Ho Chi Minh',
  phone: '0900000000',
  ghnDistrictId: 1442,
  ghnWardCode: '21211',
};

/** Guard cho phép mọi request và gắn user cố định, để test tập trung vào logic checkout. */
const allowAllAuthGuard = {
  canActivate: (context: any) => {
    context.switchToHttp().getRequest().user = AUTH_USER;
    return true;
  },
};

describe('POST /api/payments/checkout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;

  const SEPAY_ENV = {
    SEPAY_MERCHANT_ID: 'test-merchant',
    SEPAY_SECRET_KEY: 'test-secret',
  };

  beforeEach(async () => {
    prisma = createPrismaMock();

    const created = await createTestApp({
      prisma,
      metadata: {
        imports: [ConfigModule.forRoot({ load: [() => SEPAY_ENV] })],
        controllers: [PaymentsController],
        providers: [
          PaymentsService,
          SubscriptionService,
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
          .useValue(allowAllAuthGuard)
          .overrideGuard(RateLimitGuard)
          .useValue({ canActivate: () => true }),
    });

    app = created.app;
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('đơn hàng sản phẩm', () => {
    it('tạo được liên kết thanh toán cho đơn CREATED của chính user', async () => {
      const order = {
        id: 'order-1',
        orderCode: 12345678,
        userId: AUTH_USER.id,
        targetTier: null,
        amount: 350000,
        status: OrderStatus.CREATED,
        paymentStatus: PaymentStatus.PENDING,
        shippingAddressSnapshot: VALID_SHIPPING_SNAPSHOT,
        shippingInfo: null,
        items: [{ id: 'item-1', productId: 'p1', quantity: 1 }],
      };
      prisma.order.findFirst.mockResolvedValue(order);
      prisma.order.update.mockResolvedValue(order);

      const res = await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .send({ orderId: '3f0e5a54-1f6f-4c0e-9a52-2a1f8f2c9b11' })
        .expect(200);

      expect(res.body.data).toMatchObject({
        orderId: 'order-1',
        orderCode: 12345678,
        amount: 350000,
        kind: 'PRODUCT',
        provider: 'SEPAY',
      });
      expect(res.body.data.checkoutUrl).toContain('signature=');

      // Không được tạo Order mới cho đơn đã tồn tại.
      expect(prisma.order.create).not.toHaveBeenCalled();
      // Link phải được lưu lại để user quay lại thanh toán tiếp.
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentProvider: 'SEPAY' }),
        }),
      );
    });

    it('từ chối đơn đã thanh toán', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        orderCode: 1,
        userId: AUTH_USER.id,
        amount: 350000,
        status: OrderStatus.PROCESSING,
        paymentStatus: PaymentStatus.PAID,
        items: [{ id: 'item-1' }],
      });

      const res = await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .send({ orderId: '3f0e5a54-1f6f-4c0e-9a52-2a1f8f2c9b11' })
        .expect(400);

      expect(res.body.message).toContain('đã được thanh toán');
    });

    it('trả 404 khi đơn hàng thuộc user khác', async () => {
      // findFirst đã lọc theo userId nên đơn của người khác trả về null.
      prisma.order.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .send({ orderId: '3f0e5a54-1f6f-4c0e-9a52-2a1f8f2c9b11' })
        .expect(404);
    });

    it('từ chối đơn đã hủy', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        orderCode: 1,
        userId: AUTH_USER.id,
        amount: 350000,
        status: OrderStatus.CANCELLED,
        paymentStatus: PaymentStatus.PENDING,
        items: [{ id: 'item-1' }],
      });

      await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .send({ orderId: '3f0e5a54-1f6f-4c0e-9a52-2a1f8f2c9b11' })
        .expect(400);
    });
  });

  describe('nâng cấp gói', () => {
    it('tạo Order mới với targetTier', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: AUTH_USER.id,
        tier: UserTier.FREE,
      });
      const created = {
        id: 'order-sub',
        orderCode: 87654321,
        userId: AUTH_USER.id,
        targetTier: UserTier.MEMBER,
        amount: 49000,
        status: OrderStatus.CREATED,
        paymentStatus: PaymentStatus.PENDING,
      };
      prisma.order.create.mockResolvedValue(created);
      prisma.order.update.mockResolvedValue(created);

      const res = await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .send({ targetTier: 'MEMBER' })
        .expect(200);

      expect(res.body.data).toMatchObject({
        kind: 'SUBSCRIPTION',
        targetTier: 'MEMBER',
        amount: 49000,
      });
      expect(prisma.order.create).toHaveBeenCalled();
    });

    it('cho phép gia hạn khi user đã ở gói đó', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: AUTH_USER.id,
        tier: UserTier.VIP,
      });
      const created = {
        id: 'order-renew',
        orderCode: 11112222,
        userId: AUTH_USER.id,
        targetTier: UserTier.VIP,
        amount: 99000,
        status: OrderStatus.CREATED,
        paymentStatus: PaymentStatus.PENDING,
      };
      prisma.order.create.mockResolvedValue(created);
      prisma.order.update.mockResolvedValue(created);

      const res = await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .send({ targetTier: 'VIP' })
        .expect(200);

      expect(res.body.data).toMatchObject({
        kind: 'SUBSCRIPTION',
        targetTier: 'VIP',
        amount: 99000,
      });
      expect(prisma.order.create).toHaveBeenCalled();
    });

    it('từ chối gói FREE', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: AUTH_USER.id,
        tier: UserTier.MEMBER,
      });

      await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .send({ targetTier: 'FREE' })
        .expect(400);
    });

    it('upgrade giữa kỳ được prorate: chỉ thu net + trả breakdown', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: AUTH_USER.id,
        tier: UserTier.MEMBER,
      });
      prisma.subscription.findFirst.mockImplementation(async (args: any) =>
        args?.where?.status === 'SCHEDULED'
          ? null
          : {
              id: 'sub-active',
              userId: AUTH_USER.id,
              tier: UserTier.MEMBER,
              status: 'ACTIVE',
              expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
            },
      );
      prisma.order.create.mockImplementation(async ({ data }: any) => ({
        id: 'order-upgrade',
        userId: AUTH_USER.id,
        status: OrderStatus.CREATED,
        paymentStatus: PaymentStatus.PENDING,
        ...data,
      }));
      prisma.order.update.mockImplementation(async ({ data }: any) => ({
        id: 'order-upgrade',
        ...data,
      }));

      const res = await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .send({ targetTier: 'VIP' })
        .expect(200);

      // MEMBER 34k -> VIP 99k, còn 15 ngày: net = 50k - 17k = 33k.
      expect(res.body.data.amount).toBe(33000);
      expect(res.body.data.proration).toMatchObject({
        oldTier: 'MEMBER',
        newTier: 'VIP',
        remainingDays: 15,
        credit: 17000,
        debit: 50000,
        net: 33000,
      });
      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 33000,
            prorationSnapshot: expect.objectContaining({ net: 33000 }),
          }),
        }),
      );
    });

    it('upgrade khi sắp hết hạn thì thu full giá như renewal', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: AUTH_USER.id,
        tier: UserTier.MEMBER,
      });
      prisma.subscription.findFirst.mockImplementation(async (args: any) =>
        args?.where?.status === 'SCHEDULED'
          ? null
          : {
              id: 'sub-active',
              userId: AUTH_USER.id,
              tier: UserTier.MEMBER,
              status: 'ACTIVE',
              expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
            },
      );
      prisma.order.create.mockImplementation(async ({ data }: any) => ({
        id: 'order-upgrade-full',
        userId: AUTH_USER.id,
        status: OrderStatus.CREATED,
        paymentStatus: PaymentStatus.PENDING,
        ...data,
      }));
      prisma.order.update.mockImplementation(async ({ data }: any) => ({
        id: 'order-upgrade-full',
        ...data,
      }));

      const res = await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .send({ targetTier: 'VIP' })
        .expect(200);

      expect(res.body.data.amount).toBe(99000);
      expect(res.body.data.proration).toBeNull();
    });
  });

  describe('hủy lịch chuyển gói', () => {
    it('trả 404 khi không có lịch hẹn nào', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/api/payments/subscriptions/scheduled/cancel')
        .expect(404);
    });

    it('hủy SCHEDULED và bật lại auto-renew cho gói hiện tại', async () => {
      const scheduled = {
        id: 'sub-scheduled',
        userId: AUTH_USER.id,
        tier: UserTier.MEMBER,
        status: 'SCHEDULED',
      };
      const active = {
        id: 'sub-active',
        userId: AUTH_USER.id,
        tier: UserTier.VIP,
        status: 'ACTIVE',
        autoRenew: false,
        expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      };
      prisma.subscription.findFirst
        .mockResolvedValueOnce(scheduled)
        .mockResolvedValueOnce(active);
      prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
      prisma.subscription.update.mockResolvedValue({ ...active, autoRenew: true });

      const res = await request(app.getHttpServer())
        .post('/api/payments/subscriptions/scheduled/cancel')
        .expect(200);

      expect(res.body.data).toMatchObject({
        id: 'sub-scheduled',
        status: 'CANCELLED',
      });
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'sub-scheduled', status: 'SCHEDULED' }),
          data: { status: 'CANCELLED' },
        }),
      );
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-active' },
          data: { autoRenew: true },
        }),
      );
    });
  });

  describe('validation', () => {
    it('từ chối body rỗng (thiếu cả orderId và targetTier)', async () => {
      await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .send({})
        .expect(400);
    });

    it('từ chối orderId không phải UUID', async () => {
      await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .send({ orderId: 'not-a-uuid' })
        .expect(400);
    });

    it('từ chối provider lạ', async () => {
      await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .send({ targetTier: 'MEMBER', provider: 'BITCOIN' })
        .expect(400);
    });
  });
});
