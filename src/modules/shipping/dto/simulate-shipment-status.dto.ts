import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ShipmentStatus } from '@prisma/client';

export class SimulateShipmentStatusDto {
  @ApiProperty({ enum: ShipmentStatus, description: 'Trạng thái vận chuyển mới' })
  @IsEnum(ShipmentStatus)
  status!: ShipmentStatus;

  @ApiProperty({ required: false, description: 'Lý do (tùy chọn)' })
  @IsString()
  @IsOptional()
  reason?: string;
}
