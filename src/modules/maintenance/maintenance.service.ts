import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { SubscriptionService } from '../payments/subscription.service';
import { OrderStatus } from '@prisma/client';

/**
 * Dọn dẹp định kỳ những bảng chỉ phình ra theo thời gian: token đã hết hạn,
 * cache kết quả thử đồ quá TTL, subscription hết hạn, và đơn hàng PENDING
 * chưa thanh toán quá 24h.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly subscriptionService: SubscriptionService,
  ) {
    this.enabled = this.config.get<string>('MAINTENANCE_CRON_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.log('Maintenance cron đã bị tắt qua MAINTENANCE_CRON_ENABLED=false');
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'cleanup-expired-records' })
  async cleanupExpiredRecords() {
    if (!this.enabled) return;

    try {
      const tokens = await this.authService.cleanExpiredTokens();
      const tryOnCache = await this.prisma.tryOnResult.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });

      const subscriptionResult = await this.subscriptionService.expireSubscriptions();

      // Expire PENDING orders that haven't been paid after 24h
      const expiredOrders = await this.prisma.order.updateMany({
        where: {
          status: OrderStatus.PENDING,
          targetTier: null,
          createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        data: {
          status: OrderStatus.EXPIRED,
          checkoutUrl: null,
          checkoutExpiresAt: null,
        },
      });

      this.logger.log(
        `Dọn dẹp định kỳ hoàn tất | refreshTokens=${tokens.deletedRefreshTokens} ` +
          `resetTokens=${tokens.deletedResetTokens} verifyTokens=${tokens.deletedVerifyTokens} ` +
          `tryOnCache=${tryOnCache.count} expiredSubscriptions=${subscriptionResult.expiredSubscriptions} ` +
          `downgradedUsers=${subscriptionResult.downgradedUsers} expiredOrders=${expiredOrders.count}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`Dọn dẹp định kỳ thất bại: ${message}`);
    }
  }
}
