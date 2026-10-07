import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { QueryCouponDto } from './dto/query-coupon.dto';

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCouponDto) {
    const existing = await this.prisma.coupon.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException(`Mã giảm giá "${dto.code}" đã tồn tại`);
    }

    return this.prisma.coupon.create({
      data: {
        code: dto.code,
        discountType: dto.discountType,
        discountValue: new Prisma.Decimal(dto.discountValue),
        maxDiscountVnd: dto.maxDiscountVnd !== undefined ? BigInt(dto.maxDiscountVnd) : undefined,
        minOrderVnd: dto.minOrderVnd !== undefined ? BigInt(dto.minOrderVnd) : undefined,
        usageLimit: dto.usageLimit,
        usageLimitPerUser: dto.usageLimitPerUser,
        isActive: dto.isActive ?? true,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });
  }

  async findAll(query: QueryCouponDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.coupon.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.coupon.count(),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) {
      throw new NotFoundException(`Không tìm thấy mã giảm giá có ID ${id}`);
    }
    return coupon;
  }

  async update(id: string, dto: UpdateCouponDto) {
    await this.findOne(id);

    if (dto.code) {
      const existing = await this.prisma.coupon.findUnique({ where: { code: dto.code } });
      if (existing && existing.id !== id) {
        throw new ConflictException(`Mã giảm giá "${dto.code}" đã tồn tại`);
      }
    }

    return this.prisma.coupon.update({
      where: { id },
      data: {
        code: dto.code,
        discountType: dto.discountType,
        discountValue: dto.discountValue !== undefined ? new Prisma.Decimal(dto.discountValue) : undefined,
        maxDiscountVnd: dto.maxDiscountVnd !== undefined ? BigInt(dto.maxDiscountVnd) : undefined,
        minOrderVnd: dto.minOrderVnd !== undefined ? BigInt(dto.minOrderVnd) : undefined,
        usageLimit: dto.usageLimit,
        usageLimitPerUser: dto.usageLimitPerUser,
        isActive: dto.isActive,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      return await this.prisma.coupon.delete({ where: { id } });
    } catch (err) {
      const isFKViolation =
        (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') ||
        (err instanceof Error && err.message?.includes('23001') && err.message?.includes('coupon_redemptions_coupon_id_fkey'));

      if (isFKViolation) {
        throw new BadRequestException(
          'Không thể xóa mã giảm giá vì đã được sử dụng trong đơn hàng. Hãy tắt isActive thay vì xóa.',
        );
      }
      throw err;
    }
  }
}
