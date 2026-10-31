import { CouponDiscountType } from '@prisma/client';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PrismaService } from '../../src/database/prisma.service';
import type { CreateCouponDto } from '../../src/modules/coupons/dto/create-coupon.dto';

function createPrismaMock() {
  return {
    coupon: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'coupon-1' }),
      update: jest.fn().mockResolvedValue({ id: 'coupon-1' }),
    },
  };
}

describe('CouponsService', () => {
  it('tạo mã khi các trường tùy chọn gửi null (ô trống trên form)', async () => {
    const prisma = createPrismaMock();
    const service = new CouponsService(prisma as unknown as PrismaService);

    const dto: CreateCouponDto = {
      code: 'WELCOME',
      discountType: CouponDiscountType.PERCENTAGE,
      discountValue: 10,
      maxDiscountVnd: null,
      minOrderVnd: null,
      usageLimit: null,
      usageLimitPerUser: null,
      isActive: true,
      startsAt: null,
      expiresAt: null,
    };

    await service.create(dto);

    expect(prisma.coupon.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        code: 'WELCOME',
        maxDiscountVnd: undefined,
        minOrderVnd: undefined,
        startsAt: undefined,
        expiresAt: undefined,
      }),
    }));
  });

  it('chuyển các mức tiền được nhập sang BigInt', async () => {
    const prisma = createPrismaMock();
    const service = new CouponsService(prisma as unknown as PrismaService);

    await service.create({
      code: 'SALE20',
      discountType: CouponDiscountType.PERCENTAGE,
      discountValue: 20,
      maxDiscountVnd: 200000,
      minOrderVnd: 500000,
      isActive: true,
    });

    expect(prisma.coupon.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        maxDiscountVnd: BigInt(200000),
        minOrderVnd: BigInt(500000),
      }),
    }));
  });

  it('trả BigInt về number để JSON serialize được', async () => {
    const prisma = createPrismaMock();
    prisma.coupon.create.mockResolvedValue({
      id: 'coupon-2',
      code: 'SALE20',
      discountValue: 20,
      maxDiscountVnd: BigInt(200000),
      minOrderVnd: BigInt(500000),
    });
    const service = new CouponsService(prisma as unknown as PrismaService);

    const created = await service.create({
      code: 'SALE20',
      discountType: CouponDiscountType.PERCENTAGE,
      discountValue: 20,
    });

    expect(created.maxDiscountVnd).toBe(200000);
    expect(created.minOrderVnd).toBe(500000);
    expect(typeof created.maxDiscountVnd).toBe('number');
    expect(() => JSON.stringify(created)).not.toThrow();
  });

  it('cập nhật cho phép xoá mức tiền và thời hạn bằng null', async () => {
    const prisma = createPrismaMock();
    prisma.coupon.findUnique.mockResolvedValue({ id: 'coupon-1' });
    const service = new CouponsService(prisma as unknown as PrismaService);

    await service.update('coupon-1', {
      maxDiscountVnd: null,
      minOrderVnd: null,
      usageLimit: null,
      usageLimitPerUser: null,
      startsAt: null,
      expiresAt: null,
    });

    expect(prisma.coupon.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'coupon-1' },
      data: expect.objectContaining({
        maxDiscountVnd: null,
        minOrderVnd: null,
        usageLimit: null,
        usageLimitPerUser: null,
        startsAt: null,
        expiresAt: null,
      }),
    }));
  });
});
