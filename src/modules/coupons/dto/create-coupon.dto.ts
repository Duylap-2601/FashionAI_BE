import { ApiProperty } from '@nestjs/swagger';
import { CouponDiscountType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsPositive, IsString, Matches, Min } from 'class-validator';

export class CreateCouponDto {
  @ApiProperty({ description: 'Mã giảm giá (tự động viết hoa)', example: 'WELCOME' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'Mã giảm giá chỉ gồm chữ, số, gạch dưới và gạch ngang',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  code!: string;

  @ApiProperty({ enum: CouponDiscountType, description: 'Loại giảm giá' })
  @IsEnum(CouponDiscountType)
  discountType!: CouponDiscountType;

  @ApiProperty({ description: 'Giá trị giảm: % (PERCENTAGE) hoặc số tiền VND cố định (FIXED_AMOUNT)', example: 10 })
  @Type(() => Number)
  @IsPositive()
  discountValue!: number;

  @ApiProperty({ required: false, description: 'Số tiền giảm tối đa (VND), chỉ áp dụng cho loại PERCENTAGE' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  maxDiscountVnd?: number;

  @ApiProperty({ required: false, description: 'Giá trị đơn hàng tối thiểu để áp mã (VND)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  minOrderVnd?: number;

  @ApiProperty({ required: false, description: 'Tổng số lượt dùng tối đa, bỏ trống = không giới hạn' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  usageLimit?: number;

  @ApiProperty({ required: false, description: 'Số lượt dùng tối đa cho mỗi user, bỏ trống = không giới hạn' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  usageLimitPerUser?: number;

  @ApiProperty({ required: false, default: true, description: 'Bật/tắt mã giảm giá' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({ required: false, description: 'Thời điểm mã bắt đầu có hiệu lực (ISO date)' })
  @IsDateString()
  @IsOptional()
  startsAt?: string;

  @ApiProperty({ required: false, description: 'Thời điểm mã hết hiệu lực (ISO date)' })
  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}
