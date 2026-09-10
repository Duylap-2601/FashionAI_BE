import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateShipmentDto {
  @ApiProperty({ required: false, description: 'Khóa chống tạo trùng do client/admin tool cung cấp' })
  @IsString()
  @IsOptional()
  requestKey?: string;
}

export class CancelShipmentDto {
  @ApiProperty({ required: false, example: 'Khách đổi thời gian nhận, cần tạo lại vận đơn' })
  @IsString()
  @IsOptional()
  reason?: string;
}
