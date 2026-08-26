import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';
import { PrismaService } from '../../database/prisma.service';
import { AiActionType, UserTier } from '@prisma/client';
import {
  AiActionName,
  AI_ACTION_LABELS,
  AI_ACTION_LIMITS,
} from '../constants/ai-quota.constants';

@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Kiểm tra hạn mức (không trừ lượt). Ném HttpException TOO_MANY_REQUESTS nếu
   * đã hết lượt, hoặc PAYMENT_REQUIRED (402) nếu FREE try-on hoặc gói hết hạn.
   * Dùng chung cho QuotaGuard (HTTP) và ChatGateway (WS) để chỉ có MỘT nguồn sự
   * thật cho logic giới hạn.
   */
  async assertQuota(
    userId: string,
    tier: UserTier | undefined,
    action: AiActionName,
    tierExpiresAt?: Date | null,
    count = 1,
  ): Promise<void> {
    const resolvedTier: UserTier = tier ?? 'FREE';
    const limit =
      AI_ACTION_LIMITS[action]?.[resolvedTier] ?? AI_ACTION_LIMITS[action].FREE;

    // Gói hết hạn → hạ về FREE
    const isExpired = tierExpiresAt && new Date() > tierExpiresAt;
    const effectiveTier = isExpired ? 'FREE' : resolvedTier;
    const effectiveLimit = isExpired
      ? (AI_ACTION_LIMITS[action].FREE ?? 0)
      : limit;

    // FREE try-on bị cấm hẳn (không phải hết lượt, mà cấm)
    if (effectiveLimit === 0) {
      throw new HttpException(
        {
          success: false,
          code: 'SUBSCRIPTION_REQUIRED',
          message: `Tính năng "${AI_ACTION_LABELS[action]}" yêu cầu gói trả tiền. Vui lòng nâng cấp tài khoản!`,
          details: {
            action,
            tier: effectiveTier,
            reason: isExpired ? 'subscription_expired' : 'free_not_allowed',
          },
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    if (effectiveLimit === Infinity) return;

    const today = new Date().toISOString().split('T')[0];
    const redisKey = `quota:${action.toLowerCase()}:${userId}:${today}`;

    let used = 0;
    const cachedUsage = await this.redisService.get(redisKey);
    if (cachedUsage !== null) {
      used = parseInt(cachedUsage, 10);
    } else {
      const dbUsage = await this.prisma.dailyUsage.findUnique({
        where: {
          userId_action_date: { userId, action: action as AiActionType, date: today },
        },
      });
      used = dbUsage ? dbUsage.count : 0;
      await this.redisService.set(
        redisKey,
        used.toString(),
        this.secondsUntilNextMidnight(),
      );
    }

    if (used + count > effectiveLimit) {
      const midnight = new Date();
      midnight.setHours(23, 59, 59, 999);
      const remaining = Math.max(0, effectiveLimit - used);
      const needMore =
        count > 1
          ? ` Yêu cầu này cần ${count} lượt nhưng chỉ còn ${remaining} lượt.`
          : '';
      throw new HttpException(
        {
          success: false,
          code: 'QUOTA_EXCEEDED',
          message: `Bạn đã dùng ${used}/${effectiveLimit} lượt ${AI_ACTION_LABELS[action]} hôm nay của gói ${effectiveTier}.${needMore} Hãy nâng cấp tài khoản để có thêm lượt!`,
          details: {
            action,
            used,
            limit: effectiveLimit,
            requested: count,
            remaining,
            resetAt: midnight.toISOString(),
            tier: effectiveTier,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async consumeQuota(
    userId: string,
    action: AiActionName,
    count = 1,
  ): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const redisKey = `quota:${action.toLowerCase()}:${userId}:${today}`;

    // Increment in Redis
    const used = await this.redisService.incrBy(
      redisKey,
      count,
      this.secondsUntilNextMidnight(),
    );

    // Sync to DB for persistence
    this.prisma.dailyUsage.upsert({
      where: {
        userId_action_date: {
          userId,
          action: action as AiActionType,
          date: today,
        },
      },
      update: { count: { increment: count } },
      create: {
        userId,
        action: action as AiActionType,
        date: today,
        count,
      },
    }).catch((err) => {
      this.logger.warn(`Failed to sync daily usage to DB: ${err.message}`);
    });

    return used;
  }

  private secondsUntilNextMidnight() {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setDate(now.getDate() + 1);
    nextMidnight.setHours(0, 0, 0, 0);
    return Math.max(1, Math.ceil((nextMidnight.getTime() - now.getTime()) / 1000));
  }
}
