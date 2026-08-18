import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { IsEnum, IsNotEmpty } from 'class-validator';

export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: OrderStatus,
    description: 'Trạng thái đơn hàng mới',
    example: OrderStatus.CONFIRMED,
  })
  @IsEnum(OrderStatus)
  @IsNotEmpty()
  status!: OrderStatus;
}
