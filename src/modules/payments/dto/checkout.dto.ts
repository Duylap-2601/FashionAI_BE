import { ApiProperty } from '@nestjs/swagger';
import { UserTier } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export type PaymentProvider = 'SEPAY' | 'MOMO';

export class CheckoutDto {
  @ApiProperty({
    description:
      'ID đơn hàng sản phẩm đã tạo qua POST /orders. Bỏ trống nếu thanh toán nâng cấp gói.',
    required: false,
    format: 'uuid',
  })
  @ValidateIf((dto: CheckoutDto) => !dto.targetTier)
  @IsUUID()
  @IsString()
  orderId?: string;

  @ApiProperty({
    enum: [UserTier.MEMBER, UserTier.VIP],
    description:
      'Gói tài khoản muốn nâng cấp. Bỏ trống nếu đã truyền orderId.',
    example: UserTier.MEMBER,
    required: false,
  })
  @ValidateIf((dto: CheckoutDto) => !dto.orderId)
  @IsEnum(UserTier)
  targetTier?: UserTier;

  @ApiProperty({
    description: 'Cổng thanh toán. MoMo là luồng mặc định, SePay được giữ cho legacy callback.',
    enum: ['MOMO', 'SEPAY'],
    example: 'MOMO',
    required: false,
    default: 'MOMO',
  })
  @IsIn(['MOMO', 'SEPAY'])
  @IsOptional()
  provider?: PaymentProvider = 'MOMO';
}
