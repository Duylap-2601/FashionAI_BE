import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const ORDER_STATUS_SOURCES = ['USER', 'ADMIN', 'SYSTEM'] as const;
export type OrderStatusSource = (typeof ORDER_STATUS_SOURCES)[number];

export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: OrderStatus,
    description: 'Trạng thái đơn hàng mới',
    example: OrderStatus.MEASUREMENT_REVIEW,
  })
  @IsEnum(OrderStatus)
  @IsNotEmpty()
  status!: OrderStatus;

  @ApiProperty({ enum: OrderStatus, required: false, description: 'Trạng thái hiện tại client đang thấy để chống ghi đè cạnh tranh' })
  @IsEnum(OrderStatus)
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

  @ApiProperty({
    enum: ORDER_STATUS_SOURCES,
    required: false,
    description: 'Nguồn phát sinh thay đổi trạng thái (mặc định ADMIN)',
  })
  @IsIn(ORDER_STATUS_SOURCES)
  @IsOptional()
  source?: OrderStatusSource;
}
