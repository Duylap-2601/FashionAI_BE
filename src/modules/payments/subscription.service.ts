import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { UserTier } from '@prisma/client';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);
  private readonly SUBSCRIPTION_DURATION_DAYS = 30;

  constructor(private readonly prisma: PrismaService) {}

  async createOrExtendSubscription(userId: string, tier: UserTier, orderId: string) {
    const existingSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        tier,
        status: 'ACTIVE',
        expiresAt: { gte: new Date() },
      },
      orderBy: { expiresAt: 'desc' },
    });

    const now = new Date();
    const startsAt = existingSubscription ? existingSubscription.expiresAt : now;
    const expiresAt = new Date(startsAt);
    expiresAt.setDate(expiresAt.getDate() + this.SUBSCRIPTION_DURATION_DAYS);

    const subscription = await this.prisma.subscription.create({
      data: {
        userId,
        tier,
        orderId,
        status: 'ACTIVE',
        startsAt,
        expiresAt,
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { tier, tierExpiresAt: expiresAt },
    });

    this.logger.log(
      `Subscription created: user=${userId} tier=${tier} expires=${expiresAt.toISOString()}`,
    );

    return subscription;
  }

  async expireSubscriptions() {
    const now = new Date();

    const expiredSubscriptions = await this.prisma.subscription.updateMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: now },
      },
      data: { status: 'EXPIRED' },
    });

    const affectedUsers = await this.prisma.user.findMany({
      where: {
        tierExpiresAt: { lt: now, not: null },
      },
      select: { id: true, tier: true },
    });

    for (const user of affectedUsers) {
      if (user.tier !== UserTier.FREE) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { tier: UserTier.FREE, tierExpiresAt: null },
        });
      }
    }

    this.logger.log(
      `Expired ${expiredSubscriptions.count} subscriptions and downgraded ${affectedUsers.length} users to FREE`,
    );

    return {
      expiredSubscriptions: expiredSubscriptions.count,
      downgradedUsers: affectedUsers.length,
    };
  }
}
