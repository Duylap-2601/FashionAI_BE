import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { SubscriptionService } from '../payments/subscription.service';
import { PaymentsService } from '../payments/payments.service';
import { OrderStatus, PaymentStatus } from '@prisma/client';

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
    private readonly paymentsService: PaymentsService,
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

      // Expire CREATED orders that haven't been paid after 24h. Bao gồm cả
      // đơn subscription/renewal (có targetTier) để không tồn đọng nhiều đơn
      // PENDING khi user bỏ qua email nhắc gia hạn.
      const expiredOrders = await this.prisma.order.updateMany({
        where: {
          status: OrderStatus.CREATED,
          paymentStatus: PaymentStatus.PENDING,
          createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        data: {
          status: OrderStatus.CANCELLED,
          paymentStatus: PaymentStatus.EXPIRED,
          checkoutUrl: null,
          checkoutExpiresAt: null,
        },
      });

      this.logger.log(
        `Dọn dẹp định kỳ hoàn tất | refreshTokens=${tokens.deletedRefreshTokens} ` +
          `resetTokens=${tokens.deletedResetTokens} verifyTokens=${tokens.deletedVerifyTokens} ` +
          `tryOnCache=${tryOnCache.count} activatedSubscriptions=${subscriptionResult.activatedSubscriptions} ` +
          `cancelledSubscriptions=${subscriptionResult.cancelledSubscriptions} expiredSubscriptions=${subscriptionResult.expiredSubscriptions} ` +
          `downgradedUsers=${subscriptionResult.downgradedUsers} expiredOrders=${expiredOrders.count}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`Dọn dẹp định kỳ thất bại: ${message}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM, { name: 'subscription-renewal-reminders', timeZone: 'Asia/Ho_Chi_Minh' })
  async sendRenewalReminders() {
    if (!this.enabled) return;

    try {
      const result = await this.paymentsService.sendRenewalReminders();
      this.logger.log(
        `Renewal reminders sent | remindersSent=${result.remindersSent} ordersCreated=${result.ordersCreated} totalProcessed=${result.totalProcessed}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`Gửi nhắc gia hạn thất bại: ${message}`);
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'keep-alive-ping' })
  async keepAlive() {
    if (!this.enabled) return;

    const baseUrl = this.config.get<string>('PUBLIC_API_URL') ?? 'http://localhost:3002';
    // PUBLIC_API_URL là domain trần (không gồm prefix), còn HealthController nằm
    // sau global prefix `api` -> /api/health/liveness. Tự bù prefix để cron
    // không ping nhầm /health/liveness (404). Env nào đã gắn sẵn /api thì giữ.
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const apiBase = normalizedBase.endsWith('/api') ? normalizedBase : `${normalizedBase}/api`;
    const healthUrl = `${apiBase}/health/liveness`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      this.logger.log(`Keep-alive ping: ${res.status} ${res.statusText} -> ${healthUrl}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.warn(`Keep-alive ping failed: ${message} (${healthUrl})`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'payment-gateway-reconcile' })
  async reconcilePaymentGateways() {
    if (!this.enabled) return;

    try {
      const result = await this.paymentsService.reconcileGatewayPayments();
      if (!result.skipped) {
        this.logger.log(
          `Payment gateway reconcile completed | payments=${result.paymentsProcessed} refunds=${result.refundsProcessed}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`Payment gateway reconcile failed: ${message}`);
    }
  }
}
