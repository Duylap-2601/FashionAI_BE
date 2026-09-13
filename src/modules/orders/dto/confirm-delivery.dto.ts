import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ConfirmDeliveryDto {
  @ApiPropertyOptional({
    description: 'Ghi chú từ khách hàng khi xác nhận đã nhận hàng',
    example: 'Hàng đẹp, đúng size',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
