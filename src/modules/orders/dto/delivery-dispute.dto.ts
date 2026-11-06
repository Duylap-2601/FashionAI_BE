import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryDisputeResolution } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateDeliveryDisputeDto {
  @ApiProperty({
    description: 'Mô tả tình trạng chưa nhận được hàng',
    example: 'Hãng báo đã giao lúc 15h nhưng mình không có nhà và chưa nhận được kiện hàng.',
  })
  @IsString()
  @Length(10, 2000, { message: 'Mô tả phải từ 10 đến 2000 ký tự' })
  description!: string;
}

export class ResolveDeliveryDisputeDto {
  @ApiProperty({
    enum: DeliveryDisputeResolution,
    description:
      'CUSTOMER_CONFIRMED_RECEIVED/ADMIN_CONFIRMED_RECEIVED đóng tranh chấp và hoàn tất đơn; REFUNDED/LOST huỷ đơn để hoàn tiền.',
  })
  @IsEnum(DeliveryDisputeResolution)
  resolution!: DeliveryDisputeResolution;

  @ApiPropertyOptional({ description: 'Ghi chú nội bộ của admin' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNote?: string;
}
