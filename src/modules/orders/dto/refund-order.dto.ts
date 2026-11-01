import { ApiProperty } from '@nestjs/swagger';
import { RefundStatus } from '@prisma/client';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class RefundOrderDto {
  @ApiProperty({ enum: RefundStatus })
  @IsEnum(RefundStatus)
  refundStatus!: RefundStatus;

  @ApiProperty({
    required: false,
    description: 'Số tiền hoàn (VND). Bỏ trống để hoàn phần còn lại của đơn.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  amountVnd?: number;

  @ApiProperty({ required: false, description: 'Bằng chứng xử lý hoàn tiền, ví dụ mã giao dịch hoặc ảnh đối soát' })
  @IsObject()
  @IsOptional()
  evidence?: Record<string, unknown>;

  @ApiProperty({ required: false, description: 'Ghi chú nội bộ admin' })
  @IsString()
  @IsOptional()
  internalNote?: string;
}
