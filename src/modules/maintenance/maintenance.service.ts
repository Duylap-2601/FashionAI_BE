import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { SubscriptionService } from '../payments/subscription.service';
import { PaymentsService } from '../payments/payments.service';
import { OrdersService } from '../orders/orders.service';
import { ShipmentService } from '../shipping/shipment.service';

/**
 * Dọn dẹp định kỳ những bảng chỉ phình ra theo thời gian: token đã hết hạn,
 * cache kết quả thử đồ quá TTL, subscription hết hạn; hủy đơn quá hạn thanh toán
 * và tự đồng bộ trạng thái vận đơn với GHN.
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
    private readonly ordersService: OrdersService,
    private readonly shipmentService: ShipmentService,
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

      this.logger.log(
        `Dọn dẹp định kỳ hoàn tất | refreshTokens=${tokens.deletedRefreshTokens} ` +
          `resetTokens=${tokens.deletedResetTokens} verifyTokens=${tokens.deletedVerifyTokens} ` +
          `tryOnCache=${tryOnCache.count} activatedSubscriptions=${subscriptionResult.activatedSubscriptions} ` +
          `cancelledSubscriptions=${subscriptionResult.cancelledSubscriptions} expiredSubscriptions=${subscriptionResult.expiredSubscriptions} ` +
          `downgradedUsers=${subscriptionResult.downgradedUsers}`,
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

  // Đơn (kể cả đơn nâng cấp / gia hạn gói) chưa thanh toán quá hạn: hủy sớm để hạn
  // khách thấy trên trang đơn là thật, không phải chờ tới lượt dọn dẹp ban đêm.
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'expire-unpaid-orders' })
  async expireUnpaidOrders() {
    if (!this.enabled) return;

    try {
      const result = await this.ordersService.expireUnpaidOrders();
      if (result.expired > 0) {
        this.logger.log(`Đã hủy ${result.expired} đơn quá hạn thanh toán${result.remaining ? ' (còn đơn chờ lần sau)' : ''}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`Hủy đơn quá hạn thanh toán thất bại: ${message}`);
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

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'shipment-status-sync' })
  async syncShipmentStatuses() {
    if (!this.enabled) return;

    try {
      const result = await this.shipmentService.syncActiveShipments();
      if (!result.skipped && result.checked > 0) {
        this.logger.log(
          `Shipment status sync completed | checked=${result.checked} updated=${result.updated} failed=${result.failed}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`Shipment status sync failed: ${message}`);
    }
  }
}
