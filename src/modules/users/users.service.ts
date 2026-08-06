import { Injectable, NotFoundException } from '@nestjs/common';
import { UserTier } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UpdateMeasurementsDto } from './dto/update-measurements.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  AiActionName,
  AI_ACTION_LIMITS,
  AI_ACTION_LABELS,
  AI_ACTION_NAMES,
  isAiActionName,
} from '../../common/constants/ai-quota.constants';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  tier: true,
  role: true,
  isVerified: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    return user;
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name?.trim(),
        avatarUrl: dto.avatarUrl,
      },
      select: USER_SELECT,
    });
  }

  async getMeasurements(userId: string) {
    return this.prisma.measurement.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async updateMeasurements(userId: string, dto: UpdateMeasurementsDto) {
    return this.prisma.measurement.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }

  async getQuota(userId: string, action?: string) {
    const user = await this.getMe(userId);
    const selectedAction: AiActionName = isAiActionName(action) ? action : 'TRY_ON';

    const today = new Date().toISOString().split('T')[0];
    const limits = AI_ACTION_LIMITS[selectedAction];
    const limit = limits[user.tier] ?? limits[UserTier.FREE];

    const dailyUsage = await this.prisma.dailyUsage.findUnique({
      where: {
        userId_action_date: {
          userId,
          action: selectedAction as any,
          date: today,
        },
      },
    });

    const used = dailyUsage?.count ?? 0;
    const remaining = limit === Infinity ? null : Math.max(0, limit - used);

    const allActions = AI_ACTION_NAMES.reduce((acc, name) => {
      const l = AI_ACTION_LIMITS[name][user.tier] ?? AI_ACTION_LIMITS[name][UserTier.FREE];
      acc[name] = {
        label: AI_ACTION_LABELS[name],
        limit: l === Infinity ? null : l,
        unlimited: l === Infinity,
      };
      return acc;
    }, {} as Record<AiActionName, { label: string; limit: number | null; unlimited: boolean }>);

    return {
      action: selectedAction,
      tier: user.tier,
      limit: limit === Infinity ? null : limit,
      unlimited: limit === Infinity,
      used,
      remaining,
      resetAt: this.getNextMidnight(),
      limits: allActions,
    };
  }

  private getNextMidnight() {
    const resetAt = new Date();
    resetAt.setDate(resetAt.getDate() + 1);
    resetAt.setHours(0, 0, 0, 0);
    return resetAt.toISOString();
  }
}
