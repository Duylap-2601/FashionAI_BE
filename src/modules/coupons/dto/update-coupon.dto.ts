import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CouponDiscountType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsPositive, IsString, Matches, Min } from 'class-validator';
import { CreateCouponDto } from './create-coupon.dto';

export class UpdateCouponDto extends PartialType(CreateCouponDto) {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'Mã giảm giá chỉ gồm chữ, số, gạch dưới và gạch ngang',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsOptional()
  code?: string;

  @ApiProperty({ enum: CouponDiscountType, required: false })
  @IsEnum(CouponDiscountType)
  @IsOptional()
  discountType?: CouponDiscountType;

  @Type(() => Number)
  @IsPositive()
  @IsOptional()
  discountValue?: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  maxDiscountVnd?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  minOrderVnd?: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  usageLimit?: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  usageLimitPerUser?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsDateString()
  @IsOptional()
  startsAt?: string;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}
