import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { OrderStatus, UserTier } from '@prisma/client';
import { PaymentsController } from '../../src/modules/payments/payments.controller';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { SubscriptionService } from '../../src/modules/payments/subscription.service';
import { MailQueueService } from '../../src/modules/mail/mail-queue.service';
import { NotificationService } from '../../src/modules/notification/notification.service';
import { OutboxService } from '../../src/modules/outbox/services/outbox.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { RateLimitGuard } from '../../src/common/guards/rate-limit.guard';
import {
  createPrismaMock,
  createTestApp,
  PrismaMock,
} from './helpers/test-app';

/** Chuỗi giờ VN dạng SePay transactionDate, cách hiện tại `hoursAgo` giờ. */
function vnDateString(hoursAgo: number): string {
  const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const d = new Date(vnNow.getTime() - hoursAgo * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

describe('GET /api/payments/admin/unmatched-transactions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;

  const failure34000 = {
    id: 'failure-1',
    provider: 'SEPAY_WEBHOOK',
    reason: 'UNMATCHED_TRANSACTION',
    message: 'Giao dich 86449921 khong match don nao',
    rawPayload: {
      id: 86449921,
      transferAmount: 34000,
      code: null,
      content: 'IBFT PAY40146ABFC27572D82',
      transactionDate: vnDateString(1),
      referenceCode: 'FT24012345678',
      gateway: 'MBBank',
      accountNumber: '0345986537',
    },
    resolved: false,
    createdAt: new Date(),
  };

  const orderMatch = {
    orderCode: 5426868,
    amount: 34000,
    targetTier: UserTier.MEMBER,
    status: OrderStatus.PENDING,
    createdAt: new Date(Date.now() - 30 * 60 * 1000),
    user: { email: 'buyer@example.com' },
  };
  const orderWrongAmount = {
    ...orderMatch,
    orderCode: 11111111,
    amount: 30000,
    user: { email: 'other@example.com' },
  };
  const orderTooOld = {
    ...orderMatch,
    orderCode: 22222222,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
  };

  const allOrders = [orderMatch, orderWrongAmount, orderTooOld];

  beforeEach(async () => {
    prisma = createPrismaMock({
      webhookFailure: {
        findMany: jest.fn().mockResolvedValue([failure34000]),
        count: jest.fn().mockResolvedValue(1),
      },
      order: {
        // Mock tôn trọng where.createdAt của service (như Prisma thật).
        findMany: jest.fn().mockImplementation((args: any) => {
          const gte = args?.where?.createdAt?.gte as Date | undefined;
          const lte = args?.where?.createdAt?.lte as Date | undefined;
          return Promise.resolve(
            allOrders.filter((o) => (!gte || o.createdAt >= gte) && (!lte || o.createdAt <= lte)),
          );
        }),
      },
    });

    const created = await createTestApp({
      prisma,
      metadata: {
        imports: [],
        controllers: [PaymentsController],
        providers: [
          PaymentsService,
          SubscriptionService,
          { provide: ConfigService, useValue: { get: (key: string, fallback?: string) => fallback } },
          { provide: MailQueueService, useValue: { sendOrderConfirmationEmail: jest.fn(), sendRenewalReminderEmail: jest.fn() } },
          { provide: NotificationService, useValue: { create: jest.fn().mockResolvedValue({}) } },
          { provide: OutboxService, useValue: { enqueueEvent: jest.fn().mockResolvedValue({}) } },
        ],
      },
      configure: (builder) =>
        builder
          .overrideGuard(JwtAuthGuard)
          .useValue({ canActivate: () => true })
          .overrideGuard(RolesGuard)
          .useValue({ canActivate: () => true })
          .overrideGuard(RateLimitGuard)
          .useValue({ canActivate: () => true }),
    });

    app = created.app;
  });

  afterEach(async () => {
    await app?.close();
  });

  it('chỉ gợi ý đơn PENDING khớp đúng số tiền trong ±24h', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/payments/admin/unmatched-transactions')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    const item = res.body.data[0];
    expect(item.transferAmount).toBe(34000);
    expect(item.content).toContain('PAY40146ABFC27572D82');
    expect(item.candidates).toHaveLength(1);
    expect(item.candidates[0].orderCode).toBe(5426868);
    expect(item.candidates[0].userEmail).toBe('buyer@example.com');
    expect(item.candidates[0].minutesApart).toBeLessThanOrEqual(60);
    expect(res.body.meta.total).toBe(1);
  });

  it('không gợi ý gì khi không có đơn khớp số tiền', async () => {
    prisma.order.findMany = jest.fn().mockResolvedValue([orderWrongAmount]);
    const res = await request(app.getHttpServer())
      .get('/api/payments/admin/unmatched-transactions')
      .expect(200);

    expect(res.body.data[0].candidates).toHaveLength(0);
  });
});
