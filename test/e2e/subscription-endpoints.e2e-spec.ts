import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { UserTier } from '@prisma/client';
import { PaymentsController } from '../../src/modules/payments/payments.controller';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { SubscriptionService } from '../../src/modules/payments/subscription.service';
import { MailQueueService } from '../../src/modules/mail/mail-queue.service';
import { NotificationService } from '../../src/modules/notification/notification.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { OutboxService } from '../../src/modules/outbox/services/outbox.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { RateLimitGuard } from '../../src/common/guards/rate-limit.guard';
import { PaymentGatewayRegistry } from '../../src/modules/payments/gateways/payment-gateway.registry';
import {
  createPaymentGatewayRegistryMock,
  createPrismaMock,
  createTestApp,
  PrismaMock,
} from './helpers/test-app';

const DAY_MS = 24 * 60 * 60 * 1000;
const AUTH_USER = { id: 'user-1', email: 'a@b.com', tier: UserTier.FREE };

const allowAllAuthGuard = {
  canActivate: (context: any) => {
    context.switchToHttp().getRequest().user = AUTH_USER;
    return true;
  },
};

/** Các endpoint gói không nằm trong payments-checkout e2e: plans, me, cancel, resume, 409 mua mới. */
describe('Subscription endpoints (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;
  let notifications: { create: jest.Mock };

  beforeEach(async () => {
    prisma = createPrismaMock();
    notifications = { create: jest.fn().mockResolvedValue({}) };

    const created = await createTestApp({
      prisma,
      metadata: {
        imports: [ConfigModule.forRoot({ load: [() => ({ NODE_ENV: 'test' })] })],
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
          { provide: NotificationService, useValue: notifications },
          { provide: CartService, useValue: { removePurchasedItems: jest.fn().mockResolvedValue(false) } },
          { provide: OutboxService, useValue: { enqueueEvent: jest.fn().mockResolvedValue({}) } },
        ],
      },
      configure: (builder) =>
        builder
          .overrideGuard(JwtAuthGuard)
          .useValue(allowAllAuthGuard)
          .overrideGuard(RateLimitGuard)
          .useValue({ canActivate: () => true })
          .overrideProvider(PaymentGatewayRegistry)
          .useValue(createPaymentGatewayRegistryMock()),
    });

    app = created.app;
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('GET /api/payments/plans', () => {
    it('TC-178: public, trả 3 gói với giá/quota từ hằng số', async () => {
      const res = await request(app.getHttpServer()).get('/api/payments/plans').expect(200);

      const plans = res.body.data;
      expect(plans.map((p: any) => p.tier)).toEqual(['FREE', 'MEMBER', 'VIP']);
      expect(plans.map((p: any) => p.price)).toEqual([0, 34000, 99000]);
      expect(plans.map((p: any) => p.durationDays)).toEqual([0, 30, 30]);

      const vip = plans.find((p: any) => p.tier === 'VIP');
      const tryOn = vip.quotas.find((q: any) => q.action === 'TRY_ON');
      expect(tryOn).toMatchObject({ limit: 10, unlimited: false });
      const chatbot = vip.quotas.find((q: any) => q.action === 'CHATBOT');
      expect(chatbot).toMatchObject({ limit: null, unlimited: true });
    });
  });

  describe('GET /api/payments/subscriptions/me', () => {
    it('TC-179: user chưa có gói trả FREE, current/scheduled null, isFree=true', async () => {
      prisma.user.findUnique.mockResolvedValue({ tier: UserTier.FREE, tierExpiresAt: null });
      prisma.subscription.findFirst.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .get('/api/payments/subscriptions/me')
        .expect(200);

      expect(res.body.data).toMatchObject({
        tier: 'FREE',
        current: null,
        scheduled: null,
        isFree: true,
      });
    });

    it('TC-202: trả tier hiệu lực, hạn, autoRenew, current + scheduled', async () => {
      const expiresAt = new Date(Date.now() + 10 * DAY_MS);
      prisma.user.findUnique.mockResolvedValue({
        tier: UserTier.VIP,
        tierExpiresAt: expiresAt,
      });
      prisma.subscription.findFirst.mockImplementation(async (args: any) =>
        args?.where?.status === 'SCHEDULED'
          ? {
              id: 'sub-scheduled',
              tier: UserTier.MEMBER,
              startsAt: expiresAt,
              expiresAt: new Date(expiresAt.getTime() + 30 * DAY_MS),
            }
          : {
              id: 'sub-active',
              tier: UserTier.VIP,
              status: 'ACTIVE',
              autoRenew: true,
              startsAt: new Date(),
              expiresAt,
              order: { orderCode: 11112222, amount: 99000 },
            },
      );

      const res = await request(app.getHttpServer())
        .get('/api/payments/subscriptions/me')
        .expect(200);

      expect(res.body.data).toMatchObject({
        tier: 'VIP',
        isFree: false,
        current: expect.objectContaining({
          id: 'sub-active',
          tier: 'VIP',
          autoRenew: true,
          daysRemaining: 10,
          price: 99000,
        }),
        scheduled: expect.objectContaining({ id: 'sub-scheduled', tier: 'MEMBER' }),
      });
    });

    it('TC-202: tier đã hết hạn hiển thị FREE', async () => {
      prisma.user.findUnique.mockResolvedValue({
        tier: UserTier.MEMBER,
        tierExpiresAt: new Date(Date.now() - DAY_MS),
      });
      prisma.subscription.findFirst.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .get('/api/payments/subscriptions/me')
        .expect(200);

      expect(res.body.data).toMatchObject({ tier: 'FREE', isFree: true });
    });

    it('TC-202: user không tồn tại trả 404', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get('/api/payments/subscriptions/me')
        .expect(404);
    });
  });

  describe('POST /api/payments/subscriptions/cancel + resume', () => {
    const activeSub = () => ({
      id: 'sub-active',
      tier: UserTier.MEMBER,
      status: 'ACTIVE',
      autoRenew: true,
      expiresAt: new Date(Date.now() + 10 * DAY_MS),
      order: { orderCode: 33334444, amount: 34000 },
    });

    it('TC-204: tắt nhắc giữ nguyên hạn, trả accessUntil, tạo thông báo', async () => {
      prisma.subscription.findFirst.mockResolvedValue(activeSub());
      prisma.subscription.updateMany.mockResolvedValue({ count: 1 });

      const res = await request(app.getHttpServer())
        .post('/api/payments/subscriptions/cancel')
        .expect(200);

      expect(res.body.data).toMatchObject({ id: 'sub-active', autoRenew: false });
      expect(res.body.data.accessUntil).toBeDefined();
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-active', autoRenew: true },
          data: { autoRenew: false },
        }),
      );
      expect(notifications.create).toHaveBeenCalledTimes(1);
    });

    it('TC-204: đã tắt nhắc thì 400', async () => {
      prisma.subscription.findFirst.mockResolvedValue(activeSub());
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

      await request(app.getHttpServer())
        .post('/api/payments/subscriptions/cancel')
        .expect(400);
    });

    it('TC-204: chưa có gói thì 404', async () => {
      prisma.subscription.findFirst.mockResolvedValue(null);

      await request(app.getHttpServer())
        .post('/api/payments/subscriptions/cancel')
        .expect(404);
    });

    it('TC-205: bật nhắc, thông báo nhắc trước 3 ngày', async () => {
      prisma.subscription.findFirst.mockResolvedValue({ ...activeSub(), autoRenew: false });
      prisma.subscription.updateMany.mockResolvedValue({ count: 1 });

      const res = await request(app.getHttpServer())
        .post('/api/payments/subscriptions/resume')
        .expect(200);

      expect(res.body.data).toMatchObject({ id: 'sub-active', autoRenew: true });
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-active', autoRenew: false },
          data: { autoRenew: true },
        }),
      );
    });

    it('TC-205: đang bật thì 400', async () => {
      prisma.subscription.findFirst.mockResolvedValue(activeSub());
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

      await request(app.getHttpServer())
        .post('/api/payments/subscriptions/resume')
        .expect(400);
    });
  });

  describe('POST /api/payments/checkout với lịch hẹn', () => {
    it('TC-183: đã có SCHEDULED thì 409 và không tạo order', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: AUTH_USER.id, tier: UserTier.FREE });
      prisma.subscription.findFirst.mockImplementation(async (args: any) =>
        args?.where?.status === 'SCHEDULED'
          ? {
              id: 'sub-scheduled',
              tier: UserTier.MEMBER,
              startsAt: new Date(Date.now() + 5 * DAY_MS),
            }
          : null,
      );

      const res = await request(app.getHttpServer())
        .post('/api/payments/checkout')
        .send({ targetTier: 'VIP' })
        .expect(409);

      expect(res.body).toMatchObject({ success: false });
      expect(prisma.order.create).not.toHaveBeenCalled();
    });
  });
});
