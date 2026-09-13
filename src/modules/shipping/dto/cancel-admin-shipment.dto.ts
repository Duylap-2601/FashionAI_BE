import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CancelAdminShipmentDto {
  @ApiPropertyOptional({ example: 'Khách đổi thời gian nhận, cần tạo lại vận đơn' })
  @IsString()
  @IsOptional()
  reason?: string;
}
