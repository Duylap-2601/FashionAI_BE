import { ApiProperty } from '@nestjs/swagger';
import { UserTier } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';

export type PaymentProvider = 'SEPAY' | 'MOMO' | 'ZALOPAY';

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
    description: 'Cổng thanh toán. Nếu bỏ trống, backend dùng PAYMENT_DEFAULT_PROVIDER.',
    enum: ['MOMO', 'ZALOPAY', 'SEPAY'],
    example: 'MOMO',
    required: false,
  })
  @IsIn(['MOMO', 'ZALOPAY', 'SEPAY'])
  @IsOptional()
  provider?: PaymentProvider;

  @ApiProperty({
    description:
      'GA4 client_id của trình duyệt (gtag get client_id). Dùng để gắn event purchase gửi từ server vào đúng phiên.',
    example: '1234567890.1700000000',
    required: false,
  })
  @Matches(/^\d{1,20}\.\d{1,20}$/)
  @IsOptional()
  gaClientId?: string;

  @ApiProperty({
    description: 'GA4 session_id của trình duyệt (gtag get session_id). Chỉ dùng kèm gaClientId.',
    example: '1700000000',
    required: false,
  })
  @Matches(/^\d{1,20}$/)
  @IsOptional()
  gaSessionId?: string;
}
