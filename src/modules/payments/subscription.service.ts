import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { UserTier, Prisma } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';
import { MailService } from '../mail/mail.service';
import {
  SUBSCRIPTION_DURATION_DAYS,
  RENEWAL_REMINDER_DAYS_BEFORE,
  isUpgrade,
  resolveEffectiveTier,
} from '../../common/constants/subscription-plans.constants';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
  ) {}

  async getCurrentSubscription(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true, tierExpiresAt: true },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const current = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        expiresAt: { gte: new Date() },
      },
      orderBy: { expiresAt: 'desc' },
      include: {
        order: { select: { orderCode: true, amount: true } },
      },
    });

    const scheduled = await this.prisma.subscription.findFirst({
      where: { userId, status: 'SCHEDULED' },
      orderBy: { startsAt: 'asc' },
    });

    const effectiveTier = resolveEffectiveTier(user.tier, user.tierExpiresAt);
    const daysRemaining = current
      ? Math.ceil(
          (current.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        )
      : 0;

    return {
      tier: effectiveTier,
      tierExpiresAt: user.tierExpiresAt,
      current: current
        ? {
            id: current.id,
            tier: current.tier,
            status: current.status,
            autoRenew: current.autoRenew,
            startsAt: current.startsAt,
            expiresAt: current.expiresAt,
            daysRemaining: Math.max(0, daysRemaining),
            price: 0,
            order: { orderCode: current.order.orderCode, amount: Number(current.order.amount) },
          }
        : null,
      scheduled: scheduled
        ? {
            id: scheduled.id,
            tier: scheduled.tier,
            startsAt: scheduled.startsAt,
            expiresAt: scheduled.expiresAt,
          }
        : null,
      isFree: effectiveTier === 'FREE',
    };
  }

  async getSubscriptionHistory(userId: string, page = 1, limit = 20) {
    limit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          order: {
            select: {
              orderCode: true,
              amount: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.subscription.count({ where: { userId } }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async cancelAutoRenew(userId: string) {
    const current = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        expiresAt: { gte: new Date() },
      },
      orderBy: { expiresAt: 'desc' },
    });

    if (!current) {
      throw new NotFoundException(
        'Bạn chưa có gói đăng ký nào đang hoạt động.',
      );
    }

    const result = await this.prisma.subscription.updateMany({
      where: { id: current.id, autoRenew: true },
      data: { autoRenew: false },
    });

    if (result.count === 0) {
      throw new BadRequestException(
        'Gói của bạn đã tắt tự động gia hạn.',
      );
    }

    this.notificationService
      .create({
        userId,
        type: 'SYSTEM',
        title: 'Đã tắt tự động gia hạn',
        message: `Bạn vẫn sử dụng gói ${current.tier} đến ${current.expiresAt.toLocaleDateString('vi-VN')}. Bật lại bất cứ lúc nào.`,
        data: {
          subscriptionId: current.id,
          expiresAt: current.expiresAt,
        },
      })
      .catch(() => undefined);

    return {
      id: current.id,
      tier: current.tier,
      autoRenew: false,
      expiresAt: current.expiresAt,
      accessUntil: current.expiresAt,
    };
  }

  async resumeAutoRenew(userId: string) {
    const current = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        expiresAt: { gte: new Date() },
      },
      orderBy: { expiresAt: 'desc' },
    });

    if (!current) {
      throw new NotFoundException(
        'Bạn chưa có gói đăng ký nào đang hoạt động.',
      );
    }

    const result = await this.prisma.subscription.updateMany({
      where: { id: current.id, autoRenew: false },
      data: { autoRenew: true },
    });

    if (result.count === 0) {
      throw new BadRequestException(
        'Gói của bạn đang bật tự động gia hạn.',
      );
    }

    this.notificationService
      .create({
        userId,
        type: 'SYSTEM',
        title: 'Đã bật tự động gia hạn',
        message: `Chúng tôi sẽ nhắc bạn gia hạn trước ${RENEWAL_REMINDER_DAYS_BEFORE} ngày.`,
        data: {
          subscriptionId: current.id,
        },
      })
      .catch(() => undefined);

    return {
      id: current.id,
      tier: current.tier,
      autoRenew: true,
      expiresAt: current.expiresAt,
    };
  }

  async findSubscriptionsDueForRenewal(withinDays: number) {
    const now = new Date();
    const reminderDeadline = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

    return this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        autoRenew: true,
        renewalReminderSentAt: null,
        expiresAt: {
          gte: now,
          lte: reminderDeadline,
        },
        user: {
          subscriptions: {
            none: { status: 'SCHEDULED' },
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        order: {
          select: {
            orderCode: true,
            amount: true,
          },
        },
      },
      orderBy: { expiresAt: 'asc' },
    });
  }

  async markRenewalReminderSent(subscriptionId: string) {
    return this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { renewalReminderSentAt: new Date() },
    });
  }

  async createOrExtendSubscription(
    userId: string,
    tier: UserTier,
    orderId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx || this.prisma;

    const [user, currentSub] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { tier: true, tierExpiresAt: true } }),
      db.subscription.findFirst({
        where: {
          userId,
          status: { in: ['ACTIVE', 'SCHEDULED'] },
        },
        orderBy: { expiresAt: 'desc' },
      }),
    ]);

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    let mode: 'NEW' | 'RENEWAL' | 'UPGRADE' | 'DOWNGRADE';
    const now = new Date();

    // Classify the scenario
    if (!currentSub || (currentSub.status === 'ACTIVE' && currentSub.expiresAt < now)) {
      mode = 'NEW';
    } else if (currentSub.tier === tier && currentSub.status === 'ACTIVE') {
      mode = 'RENEWAL';
    } else if (isUpgrade(currentSub.tier, tier)) {
      mode = 'UPGRADE';
    } else {
      mode = 'DOWNGRADE';
    }

    if (mode === 'NEW' || mode === 'RENEWAL') {
      const startsAt = currentSub && currentSub.status === 'ACTIVE' && currentSub.expiresAt > now
        ? currentSub.expiresAt
        : now;
      const expiresAt = new Date(startsAt);
      expiresAt.setDate(expiresAt.getDate() + SUBSCRIPTION_DURATION_DAYS);

      const subscription = await db.subscription.create({
        data: {
          userId,
          tier,
          orderId,
          status: 'ACTIVE',
          autoRenew: true,
          startsAt,
          expiresAt,
        },
      });

      await db.user.update({
        where: { id: userId },
        data: { tier, tierExpiresAt: expiresAt },
      });

      this.logger.log(
        `Subscription ${mode.toLowerCase()}: user=${userId} tier=${tier} expires=${expiresAt.toISOString()}`,
      );

      return { subscription, mode };
    } else if (mode === 'UPGRADE') {
      const newExpiresAt = new Date(now);
      newExpiresAt.setDate(newExpiresAt.getDate() + SUBSCRIPTION_DURATION_DAYS);

      await db.subscription.update({
        where: { id: currentSub!.id },
        data: {
          status: 'CANCELLED',
          autoRenew: false,
          expiresAt: now,
        },
      });

      const subscription = await db.subscription.create({
        data: {
          userId,
          tier,
          orderId,
          status: 'ACTIVE',
          autoRenew: true,
          startsAt: now,
          expiresAt: newExpiresAt,
        },
      });

      await db.user.update({
        where: { id: userId },
        data: { tier, tierExpiresAt: newExpiresAt },
      });

      const scheduledSub = await db.subscription.findFirst({
        where: { userId, status: 'SCHEDULED' },
      });
      if (scheduledSub) {
        await db.subscription.update({
          where: { id: scheduledSub.id },
          data: { status: 'CANCELLED' },
        });
      }

      this.logger.log(
        `Subscription UPGRADE: user=${userId} from ${currentSub!.tier} to ${tier} effective=${now.toISOString()}`,
      );

      return { subscription, mode };
    } else {
      const startsAt = currentSub!.expiresAt;
      const expiresAt = new Date(startsAt);
      expiresAt.setDate(expiresAt.getDate() + SUBSCRIPTION_DURATION_DAYS);

      const subscription = await db.subscription.create({
        data: {
          userId,
          tier,
          orderId,
          status: 'SCHEDULED',
          autoRenew: true,
          startsAt,
          expiresAt,
        },
      });

      await db.subscription.update({
        where: { id: currentSub!.id },
        data: { autoRenew: false },
      });

      this.logger.log(
        `Subscription DOWNGRADE SCHEDULED: user=${userId} from ${currentSub!.tier} to ${tier} effective=${startsAt.toISOString()}`,
      );

      return { subscription, mode };
    }
  }

  async expireSubscriptions() {
    const now = new Date();

    // Step A: Activate due SCHEDULED subscriptions
    const scheduledSubs = await this.prisma.subscription.findMany({
      where: { status: 'SCHEDULED', startsAt: { lte: now } },
      include: { user: { select: { id: true } } },
    });

    let activatedCount = 0;
    for (const sub of scheduledSubs) {
      const actualExpiresAt = new Date(Math.max(sub.startsAt.getTime(), now.getTime()));
      actualExpiresAt.setDate(actualExpiresAt.getDate() + SUBSCRIPTION_DURATION_DAYS);

      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'ACTIVE', expiresAt: actualExpiresAt },
      });

      await this.prisma.user.update({
        where: { id: sub.userId },
        data: { tier: sub.tier, tierExpiresAt: actualExpiresAt },
      });

      this.notificationService
        .create({
          userId: sub.userId,
          type: 'SYSTEM',
          title: `Gói ${sub.tier} đã bắt đầu`,
          message: `Gói của bạn đã kích hoạt, hiệu lực đến ${actualExpiresAt.toLocaleDateString('vi-VN')}.`,
          data: { subscriptionId: sub.id, tier: sub.tier, expiresAt: actualExpiresAt },
        })
        .catch(() => undefined);

      activatedCount++;
    }

    // Step B: Expire ACTIVE subscriptions past their date
    const cancelledResult = await this.prisma.subscription.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now }, autoRenew: false },
      data: { status: 'CANCELLED' },
    });

    const expiredResult = await this.prisma.subscription.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now }, autoRenew: true },
      data: { status: 'EXPIRED' },
    });

    const totalExpired = cancelledResult.count + expiredResult.count;

    // Step C: Downgrade users to FREE
    const affectedUsers = await this.prisma.user.findMany({
      where: {
        tierExpiresAt: { lt: now, not: null },
        tier: { not: 'FREE' },
      },
      select: { id: true, tier: true },
    });

    if (affectedUsers.length > 0) {
      await this.prisma.user.updateMany({
        where: {
          tierExpiresAt: { lt: now, not: null },
          tier: { not: 'FREE' },
        },
        data: { tier: 'FREE', tierExpiresAt: null },
      });

      for (const user of affectedUsers) {
        this.notificationService
          .create({
            userId: user.id,
            type: 'SYSTEM',
            title: `Gói ${user.tier} đã hết hạn`,
            message: 'Tài khoản đã chuyển về gói Miễn phí.',
            data: { previousTier: user.tier },
          })
          .catch(() => undefined);
      }
    }

    this.logger.log(
      `Expired ${totalExpired} subscriptions (${cancelledResult.count} cancelled, ${expiredResult.count} expired), ` +
      `activated ${activatedCount} scheduled subs, downgraded ${affectedUsers.length} users to FREE`,
    );

    return {
      activatedSubscriptions: activatedCount,
      cancelledSubscriptions: cancelledResult.count,
      expiredSubscriptions: expiredResult.count,
      downgradedUsers: affectedUsers.length,
    };
  }
}
