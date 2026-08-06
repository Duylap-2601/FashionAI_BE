import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';
import { PrismaService } from '../../database/prisma.service';
import { AiActionType } from '@prisma/client';
import { AiActionName } from '../constants/ai-quota.constants';

@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async consumeQuota(userId: string, action: AiActionName): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const redisKey = `quota:${action.toLowerCase()}:${userId}:${today}`;

    // Increment in Redis
    const used = await this.redisService.incr(redisKey, 86400);

    // Sync to DB for persistence
    this.prisma.dailyUsage.upsert({
      where: {
        userId_action_date: {
          userId,
          action: action as AiActionType,
          date: today,
        },
      },
      update: { count: { increment: 1 } },
      create: {
        userId,
        action: action as AiActionType,
        date: today,
        count: 1,
      },
    }).catch((err) => {
      this.logger.warn(`Failed to sync daily usage to DB: ${err.message}`);
    });

    return used;
  }
}
