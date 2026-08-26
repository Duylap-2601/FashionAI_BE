import { Injectable, NotFoundException } from '@nestjs/common';
import { GarmentCategory, UserTier } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PAID_STATUSES } from '../../common/constants/order.constants';
import { UpdateMeasurementsDto } from './dto/update-measurements.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserAdminDto } from './dto/update-user-admin.dto';
import {
  MEASUREMENT_LABELS,
  REQUIRED_MEASUREMENTS_BY_CATEGORY,
  getMissingMeasurements,
} from '../../common/constants/measurement.constants';
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
  tierExpiresAt: true,
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
    const m = await this.prisma.measurement.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    // Return with FE-compatible aliases
    return {
      ...m,
      bodyLength: m.shirtLength,
      trouserLength: m.outseam,
    };
  }

  async getMeasurementCompleteness(userId: string) {
    const measurement = await this.prisma.measurement.findUnique({
      where: { userId },
    });

    const categories = Object.values(GarmentCategory);
    const byCategory = categories.map((category) => {
      const required = REQUIRED_MEASUREMENTS_BY_CATEGORY[category];
      const missing = getMissingMeasurements(measurement as any, [category]);
      return {
        category,
        complete: missing.length === 0,
        requiredFields: [...required],
        missingFields: missing,
        missing: missing.map((field) => ({
          field,
          label: MEASUREMENT_LABELS[field],
        })),
      };
    });

    // Đủ để đặt may khi mọi phân loại đều đủ số đo bắt buộc.
    const canOrder = byCategory.every((c) => c.complete);

    return {
      canOrder,
      hasMeasurement: Boolean(measurement),
      byCategory,
    };
  }

  async updateMeasurements(userId: string, dto: UpdateMeasurementsDto) {
    // Handle FE aliases: bodyLength → shirtLength, trouserLength → outseam
    const { bodyLength, trouserLength, ...rest } = dto as any;
    const data = {
      ...rest,
      ...(bodyLength !== undefined && { shirtLength: bodyLength }),
      ...(trouserLength !== undefined && { outseam: trouserLength }),
    };

    return this.prisma.measurement.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  async findAllAdmin(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [items, total, spentByUser] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          ...USER_SELECT,
          _count: {
            select: { tryOnResults: true, orders: true, stylistResults: true },
          },
        },
      }),
      this.prisma.user.count(),
      this.prisma.order.groupBy({
        by: ['userId'],
        _sum: { amount: true },
        // Gồm cả trạng thái sau thanh toán, nếu không `spent` sẽ tụt về 0 ngay khi
        // admin xác nhận/giao đơn.
        where: { status: { in: PAID_STATUSES } },
      }),
    ]);

    const spentMap = new Map(
      spentByUser.map((item) => [item.userId, item._sum.amount]),
    );

    return {
      items: items.map((user) => ({
        ...user,
        tryOns: user._count.tryOnResults,
        orders: user._count.orders,
        spent: Number(spentMap.get(user.id) ?? 0),
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async updateByAdmin(id: string, dto: UpdateUserAdminDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: USER_SELECT,
    });
  }

  async getQuota(userId: string, action?: string) {
    const user = await this.getMe(userId);
    const selectedAction: AiActionName = isAiActionName(action) ? action : 'TRY_ON';

    const isExpired = user.tierExpiresAt && new Date() > user.tierExpiresAt;
    const effectiveTier = isExpired ? UserTier.FREE : user.tier;

    const today = new Date().toISOString().split('T')[0];
    const limits = AI_ACTION_LIMITS[selectedAction];
    const limit = limits[effectiveTier] ?? limits[UserTier.FREE];

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
      const l = AI_ACTION_LIMITS[name][effectiveTier] ?? AI_ACTION_LIMITS[name][UserTier.FREE];
      acc[name] = {
        label: AI_ACTION_LABELS[name],
        limit: l === Infinity ? null : l,
        unlimited: l === Infinity,
      };
      return acc;
    }, {} as Record<AiActionName, { label: string; limit: number | null; unlimited: boolean }>);

    return {
      action: selectedAction,
      tier: effectiveTier,
      limit: limit === Infinity ? null : limit,
      unlimited: limit === Infinity,
      used,
      remaining,
      resetAt: this.getNextMidnight(),
      tierExpiresAt: user.tierExpiresAt?.toISOString() ?? null,
      requiresSubscription: limit === 0,
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
