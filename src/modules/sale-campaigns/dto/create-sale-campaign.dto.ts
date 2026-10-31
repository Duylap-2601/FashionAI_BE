import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateSaleCampaignDto {
  @ApiProperty({ description: 'Tên chiến dịch sale', example: 'Sale Thu 2026' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: 'Phần trăm giảm giá, lớn hơn 0 và nhỏ hơn 100', example: 30 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(99.99)
  discountPercent!: number;

  @ApiProperty({ required: false, default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({ required: false, description: 'Thời điểm bắt đầu (ISO date)' })
  @IsDateString()
  @IsOptional()
  startsAt?: string | null;

  @ApiProperty({ required: false, description: 'Thời điểm kết thúc (ISO date), là biên mở' })
  @IsDateString()
  @IsOptional()
  endsAt?: string | null;

  @ApiProperty({ description: 'Danh sách product id áp dụng', type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayUnique()
  productIds!: string[];
}
