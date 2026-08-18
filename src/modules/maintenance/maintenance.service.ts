import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../auth/auth.service';

/**
 * Dọn dẹp định kỳ những bảng chỉ phình ra theo thời gian: token đã hết hạn và
 * cache kết quả thử đồ quá TTL. Trước đây chỉ có endpoint gọi tay
 * (`POST /auth/clean-tokens`), nghĩa là trên môi trường thật không ai dọn.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {
    // Nhiều instance cùng chạy cron sẽ lặp việc vô ích; cho phép tắt bằng env để
    // chỉ một worker đảm nhiệm.
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

      this.logger.log(
        `Dọn dẹp định kỳ hoàn tất | refreshTokens=${tokens.deletedRefreshTokens} ` +
          `resetTokens=${tokens.deletedResetTokens} verifyTokens=${tokens.deletedVerifyTokens} ` +
          `tryOnCache=${tryOnCache.count}`,
      );
    } catch (err) {
      // Cron thất bại không được làm sập process.
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`Dọn dẹp định kỳ thất bại: ${message}`);
    }
  }
}
