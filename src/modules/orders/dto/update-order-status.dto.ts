import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CANONICAL_ORDER_STATUSES } from '../constants/order-flow.constants';

export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: CANONICAL_ORDER_STATUSES,
    description: 'Trạng thái đơn hàng mới',
    example: OrderStatus.PROCESSING,
  })
  @IsIn(CANONICAL_ORDER_STATUSES)
  @IsNotEmpty()
  status!: OrderStatus;

  @ApiProperty({ enum: CANONICAL_ORDER_STATUSES, required: false, description: 'Trạng thái hiện tại client đang thấy để chống ghi đè cạnh tranh' })
  @IsIn(CANONICAL_ORDER_STATUSES)
  @IsOptional()
  expectedStatus?: OrderStatus;

  @ApiProperty({ required: false, description: 'Nội dung khách hàng được thấy trong timeline' })
  @IsString()
  @IsOptional()
  publicMessage?: string;

  @ApiProperty({ required: false, description: 'Ghi chú nội bộ admin, không trả về cho khách' })
  @IsString()
  @IsOptional()
  internalNote?: string;
}
