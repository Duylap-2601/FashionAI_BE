import { ApiProperty } from '@nestjs/swagger';
import { UserTier } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CheckoutDto {
  @ApiProperty({
    enum: [UserTier.MEMBER, UserTier.VIP],
    description: 'Gói tài khoản muốn nâng cấp (MEMBER hoặc VIP)',
    example: UserTier.MEMBER,
  })
  @IsEnum(UserTier)
  @IsNotEmpty()
  targetTier!: UserTier;

  @ApiProperty({
    description: 'Cổng thanh toán lựa chọn: PAYOS hoặc MOMO',
    example: 'MOMO',
    required: false,
    default: 'MOMO',
  })
  @IsString()
  @IsOptional()
  provider?: 'PAYOS' | 'MOMO' = 'MOMO';
}
