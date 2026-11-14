import { UserTier } from '@prisma/client';
import { PaymentsService } from '../../src/modules/payments/payments.service';

const DAY_MS = 24 * 60 * 60 * 1000;

function createService(acquired: boolean) {
  const prisma: any = {
    order: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'order-1', orderCode: 12345678 }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const redisService = {
    acquireLock: jest.fn().mockResolvedValue(acquired),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  };
  const subscriptionService = {
    findSubscriptionsDueForRenewal: jest.fn().mockResolvedValue([
      {
        id: 'sub-1',
        userId: 'user-1',
        tier: UserTier.MEMBER,
        expiresAt: new Date(Date.now() + 2 * DAY_MS),
        user: { id: 'user-1', email: 'a@b.com', name: 'Khách' },
      },
    ]),
    markRenewalReminderSent: jest.fn().mockResolvedValue({}),
  };
  const notificationService = { create: jest.fn().mockResolvedValue({}) };
  const mailQueueService = { sendRenewalReminderEmail: jest.fn().mockResolvedValue(undefined) };

  const service = new PaymentsService(
    {} as any,
    prisma,
    mailQueueService as any,
    notificationService as any,
    subscriptionService as any,
    {} as any,
    redisService as any,
    {} as any,
    {} as any,
  );
  // createSePayCheckoutLink cần config; stub để test tập trung vào lock.
  (service as any).createSePayCheckoutLink = jest
    .fn()
    .mockResolvedValue({ checkoutUrl: 'https://pay.test/link' });

  return { service, redisService, subscriptionService, mailQueueService, notificationService };
}

describe('PaymentsService.sendRenewalReminders – lock phân tán', () => {
  it('không lấy được lock: thoát sớm, không gửi mail và không tạo đơn', async () => {
    const { service, redisService, subscriptionService, mailQueueService } = createService(false);

    const result = await service.sendRenewalReminders();

    expect(redisService.acquireLock).toHaveBeenCalledWith('subscription-renewal-reminders', 120);
    expect(result).toMatchObject({ remindersSent: 0, ordersCreated: 0, skipped: true });
    expect(subscriptionService.findSubscriptionsDueForRenewal).not.toHaveBeenCalled();
    expect(mailQueueService.sendRenewalReminderEmail).not.toHaveBeenCalled();
    // Không giữ lock thì cũng không được release lock của instance khác.
    expect(redisService.releaseLock).not.toHaveBeenCalled();
  });

  it('lấy được lock: gửi nhắc, đánh dấu đã nhắc và luôn release lock', async () => {
    const { service, redisService, subscriptionService, mailQueueService } = createService(true);

    const result = await service.sendRenewalReminders();

    expect(result).toMatchObject({ remindersSent: 1, ordersCreated: 1, totalProcessed: 1 });
    expect(mailQueueService.sendRenewalReminderEmail).toHaveBeenCalledTimes(1);
    expect(subscriptionService.markRenewalReminderSent).toHaveBeenCalledWith('sub-1');
    expect(redisService.releaseLock).toHaveBeenCalledWith('subscription-renewal-reminders');
  });

  it('release lock cả khi một subscription xử lý lỗi', async () => {
    const { service, redisService, mailQueueService } = createService(true);
    mailQueueService.sendRenewalReminderEmail.mockRejectedValue(new Error('mail down'));

    const result = await service.sendRenewalReminders();

    expect(result).toMatchObject({ remindersSent: 0, totalProcessed: 1 });
    expect(redisService.releaseLock).toHaveBeenCalledWith('subscription-renewal-reminders');
  });
});
