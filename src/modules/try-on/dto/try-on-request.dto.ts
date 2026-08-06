import { ApiProperty } from '@nestjs/swagger';
import { GarmentCategory } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class TryOnRequestDto {
  @ApiProperty({
    description: 'ID sản phẩm trang phục từ Catalog (tùy chọn, nếu truyền không cần upload ảnh garment)',
    required: false,
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({
    description: 'Loại trang phục (UPPER, LOWER, FULL_BODY)',
    enum: GarmentCategory,
    default: GarmentCategory.UPPER,
    required: false,
    example: GarmentCategory.UPPER,
  })
  @IsOptional()
  @IsEnum(GarmentCategory)
  garmentCategory?: GarmentCategory = GarmentCategory.UPPER;
}
