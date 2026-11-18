import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';
import { PrismaService } from '../../database/prisma.service';
import { AiActionType, UserTier } from '@prisma/client';
import {
  AiActionName,
  AI_ACTION_LABELS,
  AI_ACTION_LIMITS,
} from '../constants/ai-quota.constants';
import {
  nextQuotaReset,
  quotaDateKey,
  secondsUntilQuotaReset,
} from '../utils/quota-date.util';

interface ResolvedLimit {
  effectiveTier: UserTier;
  effectiveLimit: number;
  isExpired: boolean;
}

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
    const { effectiveTier, effectiveLimit, isExpired } = this.resolveLimit(
      action,
      tier,
      tierExpiresAt,
    );

    if (effectiveLimit === 0) {
      this.throwSubscriptionRequired(action, effectiveTier, isExpired);
    }
    if (effectiveLimit === Infinity) return;

    const today = quotaDateKey();
    const redisKey = this.quotaKey(action, userId, today);

    const used = await this.readUsage(redisKey, action, userId, today);
    if (used + count > effectiveLimit) {
      throw this.buildQuotaExceeded(action, effectiveTier, effectiveLimit, used, count);
    }
  }

  /**
   * Giữ chỗ trước khi gọi provider: tăng counter nguyên tử rồi kiểm tra. Nếu
   * vượt hạn mức thì trả chỗ ngay và ném 429. Hai request đồng thời không thể
   * cùng vượt hạn mức vì phép tăng counter là one round-trip/one Map update.
   * Request lỗi hoặc cache hit phải gọi `releaseQuota` để hoàn lượt.
   */
  async reserveQuota(
    userId: string,
    tier: UserTier | undefined,
    action: AiActionName,
    tierExpiresAt?: Date | null,
    count = 1,
  ): Promise<boolean> {
    const { effectiveTier, effectiveLimit, isExpired } = this.resolveLimit(
      action,
      tier,
      tierExpiresAt,
    );

    if (effectiveLimit === 0) {
      this.throwSubscriptionRequired(action, effectiveTier, isExpired);
    }
    // VIP không giới hạn: không giữ chỗ, và người gọi không được release.
    if (effectiveLimit === Infinity) return false;

    const today = quotaDateKey();
    const redisKey = this.quotaKey(action, userId, today);
    const ttl = secondsUntilQuotaReset();

    // Seed counter từ DB nếu cache đang trống. SET NX để hai request đồng thời
    // không ghi đè counter của nhau.
    if ((await this.redisService.get(redisKey)) === null) {
      const dbUsage = await this.prisma.dailyUsage.findUnique({
        where: {
          userId_action_date: { userId, action: action as AiActionType, date: today },
        },
      });
      await this.redisService.setIfAbsent(redisKey, String(dbUsage ? dbUsage.count : 0), ttl);
    }

    const usedAfterReserve = await this.redisService.incrBy(redisKey, count, ttl);
    if (usedAfterReserve > effectiveLimit) {
      await this.redisService.decrBy(redisKey, count);
      const usedBefore = Math.max(0, usedAfterReserve - count);
      throw this.buildQuotaExceeded(action, effectiveTier, effectiveLimit, usedBefore, count);
    }

    this.syncUsageToDb(userId, action, today, count);
    return true;
  }

  /** Hoàn lượt đã giữ chỗ khi provider lỗi hoặc kết quả lấy từ cache. */
  async releaseQuota(userId: string, action: AiActionName, count = 1): Promise<void> {
    const today = quotaDateKey();
    const redisKey = this.quotaKey(action, userId, today);

    await this.redisService.decrBy(redisKey, count);

    try {
      await this.prisma.dailyUsage.updateMany({
        where: {
          userId,
          action: action as AiActionType,
          date: today,
          count: { gte: count },
        },
        data: { count: { decrement: count } },
      });
    } catch (err) {
      this.logger.warn(`Failed to release daily usage in DB: ${this.getErrorMessage(err)}`);
    }
  }

  async consumeQuota(
    userId: string,
    action: AiActionName,
    count = 1,
  ): Promise<number> {
    const today = quotaDateKey();
    const redisKey = this.quotaKey(action, userId, today);

    // Increment in Redis
    const used = await this.redisService.incrBy(
      redisKey,
      count,
      secondsUntilQuotaReset(),
    );

    // Sync to DB for persistence
    this.syncUsageToDb(userId, action, today, count);

    return used;
  }

  private resolveLimit(
    action: AiActionName,
    tier: UserTier | undefined,
    tierExpiresAt?: Date | null,
  ): ResolvedLimit {
    const resolvedTier: UserTier = tier ?? 'FREE';
    const limit =
      AI_ACTION_LIMITS[action]?.[resolvedTier] ?? AI_ACTION_LIMITS[action].FREE;

    // Gói hết hạn → hạ về FREE
    const isExpired = Boolean(tierExpiresAt && new Date() > tierExpiresAt);
    const effectiveTier: UserTier = isExpired ? 'FREE' : resolvedTier;
    const effectiveLimit = isExpired
      ? (AI_ACTION_LIMITS[action].FREE ?? 0)
      : limit;

    return { effectiveTier, effectiveLimit, isExpired };
  }

  private quotaKey(action: AiActionName, userId: string, today: string): string {
    return `quota:${action.toLowerCase()}:${userId}:${today}`;
  }

  /** Đọc usage từ cache; cache miss thì lấy từ DB và seed lại. */
  private async readUsage(
    redisKey: string,
    action: AiActionName,
    userId: string,
    today: string,
  ): Promise<number> {
    const cachedUsage = await this.redisService.get(redisKey);
    if (cachedUsage !== null) {
      return parseInt(cachedUsage, 10) || 0;
    }

    const dbUsage = await this.prisma.dailyUsage.findUnique({
      where: {
        userId_action_date: { userId, action: action as AiActionType, date: today },
      },
    });
    const used = dbUsage ? dbUsage.count : 0;
    await this.redisService.set(redisKey, used.toString(), secondsUntilQuotaReset());
    return used;
  }

  private syncUsageToDb(
    userId: string,
    action: AiActionName,
    today: string,
    count: number,
  ): void {
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
      this.logger.warn(`Failed to sync daily usage to DB: ${this.getErrorMessage(err)}`);
    });
  }

  private throwSubscriptionRequired(
    action: AiActionName,
    effectiveTier: UserTier,
    isExpired: boolean,
  ): never {
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

  private buildQuotaExceeded(
    action: AiActionName,
    effectiveTier: UserTier,
    effectiveLimit: number,
    used: number,
    count: number,
  ): HttpException {
    const resetAt = nextQuotaReset();
    const remaining = Math.max(0, effectiveLimit - used);
    const needMore =
      count > 1
        ? ` Yêu cầu này cần ${count} lượt nhưng chỉ còn ${remaining} lượt.`
        : '';
    return new HttpException(
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
          resetAt: resetAt.toISOString(),
          tier: effectiveTier,
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
