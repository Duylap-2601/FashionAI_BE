import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class CreateMeasurementReviewDto {
  @ApiProperty({ example: 'Vui lòng kiểm tra lại vòng ngực và vai.' })
  @IsString()
  message!: string;

  @ApiProperty({ required: false, description: 'Ghi chú nội bộ admin' })
  @IsString()
  @IsOptional()
  internalNote?: string;
}

export class UpdateItemMeasurementDto {
  @ApiProperty({ description: 'Snapshot số đo mới cho item theo yêu cầu đang mở' })
  @IsObject()
  measurementSnapshot!: Record<string, unknown>;
}
