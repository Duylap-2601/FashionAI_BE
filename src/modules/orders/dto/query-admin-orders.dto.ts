import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsString, Min } from 'class-validator';

export class QueryAdminOrdersDto {
  @ApiProperty({ enum: OrderStatus, required: false })
  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus;

  @ApiProperty({ enum: PaymentStatus, required: false })
  @IsEnum(PaymentStatus)
  @IsOptional()
  paymentStatus?: PaymentStatus;

  @ApiProperty({ required: false, description: 'Tìm theo mã đơn (orderCode), tên hoặc email khách hàng' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiProperty({ required: false, description: 'Lọc đơn tạo từ ngày này (ISO date)' })
  @IsDateString()
  @IsOptional()
  fromDate?: string;

  @ApiProperty({ required: false, description: 'Lọc đơn tạo đến ngày này (ISO date)' })
  @IsDateString()
  @IsOptional()
  toDate?: string;

  @ApiProperty({ required: false, default: 1 })
  @Type(() => Number)
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiProperty({ required: false, default: 20 })
  @Type(() => Number)
  @Min(1)
  @IsOptional()
  limit?: number = 20;
}
