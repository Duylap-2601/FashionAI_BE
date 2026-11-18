import { ApiProperty } from '@nestjs/swagger';
import { UserTier } from '@prisma/client';
import { IsIn } from 'class-validator';

export class SubscriptionQuoteQueryDto {
  @ApiProperty({
    enum: [UserTier.MEMBER, UserTier.VIP],
    description: 'Gói muốn mua; giá trả về đã tính phần chênh lệch nếu nâng cấp giữa kỳ.',
    example: UserTier.VIP,
  })
  @IsIn([UserTier.MEMBER, UserTier.VIP])
  targetTier!: UserTier;
}
