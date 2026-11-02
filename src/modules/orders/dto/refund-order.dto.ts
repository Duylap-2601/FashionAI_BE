import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RefundStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RefundOrderDto {
  @ApiProperty({ enum: RefundStatus })
  @IsEnum(RefundStatus)
  refundStatus!: RefundStatus;

  @ApiProperty({
    required: false,
    description: 'Số tiền hoàn (VND). Bỏ trống để hoàn phần còn lại của đơn.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  amountVnd?: number;

  @ApiProperty({ required: false, description: 'Bằng chứng xử lý hoàn tiền, ví dụ mã giao dịch hoặc ảnh đối soát' })
  @IsObject()
  @IsOptional()
  evidence?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Mã giao dịch / ghi chú chứng từ chuyển khoản (dùng khi gửi multipart kèm ảnh chứng từ)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  evidenceReference?: string;

  @ApiProperty({ required: false, description: 'Ghi chú nội bộ admin' })
  @IsString()
  @IsOptional()
  internalNote?: string;
}
