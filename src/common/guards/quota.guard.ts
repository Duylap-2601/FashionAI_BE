import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserTier } from '@prisma/client';
import { RedisService } from '../services/redis.service';
import { PrismaService } from '../../database/prisma.service';
import {
  AiActionName,
  AI_ACTION_LIMITS,
  AI_ACTION_LABELS,
} from '../constants/ai-quota.constants';

export const AI_ACTION_KEY = 'ai_action_type';
export const AiAction = (action: AiActionName) => SetMetadata(AI_ACTION_KEY, action);

@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action: AiActionName =
      this.reflector.getAllAndOverride<AiActionName>(AI_ACTION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'TRY_ON';

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new HttpException(
        {
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Bạn cần đăng nhập để sử dụng tính năng AI.',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const tier: UserTier = user.tier ?? 'FREE';
    const limit = AI_ACTION_LIMITS[action]?.[tier] ?? AI_ACTION_LIMITS[action].FREE;

    if (limit === Infinity) {
      return true;
    }

    const today = new Date().toISOString().split('T')[0];
    const redisKey = `quota:${action.toLowerCase()}:${user.id}:${today}`;

    let used = 0;
    const cachedUsage = await this.redisService.get(redisKey);

    if (cachedUsage !== null) {
      used = parseInt(cachedUsage, 10);
    } else {
      const dbUsage = await this.prisma.dailyUsage.findUnique({
        where: {
          userId_action_date: {
            userId: user.id,
            action: action as any,
            date: today,
          },
        },
      });
      used = dbUsage ? dbUsage.count : 0;
      await this.redisService.set(
        redisKey,
        used.toString(),
        this.secondsUntilNextMidnight(),
      );
    }

    if (used >= limit) {
      const midnight = new Date();
      midnight.setHours(23, 59, 59, 999);

      throw new HttpException(
        {
          success: false,
          code: 'QUOTA_EXCEEDED',
          message: `Bạn đã dùng hết ${limit}/${limit} lượt ${AI_ACTION_LABELS[action]} hôm nay của gói ${tier}. Hãy nâng cấp tài khoản để có thêm lượt!`,
          details: {
            action,
            used,
            limit,
            remaining: 0,
            resetAt: midnight.toISOString(),
            tier,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Guard chỉ kiểm tra hạn mức. Việc trừ quota do service thực hiện sau khi
    // gọi provider thành công (xem QuotaService.consumeQuota), để request lỗi
    // hoặc cache hit không bị tính lượt.
    return true;
  }

  private secondsUntilNextMidnight() {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setDate(now.getDate() + 1);
    nextMidnight.setHours(0, 0, 0, 0);
    return Math.max(1, Math.ceil((nextMidnight.getTime() - now.getTime()) / 1000));
  }
}
