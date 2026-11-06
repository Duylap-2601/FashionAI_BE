import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { MEASUREMENT_SNAPSHOT_FIELDS } from '../constants/order-flow.constants';

export class CreateMeasurementReviewDto {
  @ApiProperty({ example: 'Vui lòng kiểm tra lại vòng ngực và vai.' })
  @IsString()
  message!: string;

  @ApiProperty({ required: false, description: 'Ghi chú nội bộ admin' })
  @IsString()
  @IsOptional()
  internalNote?: string;

  @ApiProperty({
    required: false,
    description: 'Các field cần khách bổ sung/chỉnh; BE luôn hợp với field bắt buộc theo loại trang phục.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsIn(MEASUREMENT_SNAPSHOT_FIELDS, { each: true })
  fields?: string[];
}

export class UpdateMeasurementReviewDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsIn(MEASUREMENT_SNAPSHOT_FIELDS, { each: true })
  fields?: string[];
}

export class UpdateItemMeasurementDto {
  @ApiProperty({ description: 'Snapshot số đo mới cho item theo yêu cầu đang mở' })
  @IsObject()
  measurementSnapshot!: Record<string, unknown>;

  @ApiProperty({ required: false, description: 'Ghi đè luôn vào hồ sơ số đo cá nhân' })
  @IsOptional()
  @IsBoolean()
  syncToProfile?: boolean;
}
