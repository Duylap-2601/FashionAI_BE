import { ApiProperty } from '@nestjs/swagger';
import { GarmentCategory, ProductStatus } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ description: 'Tên sản phẩm', example: 'Áo sơ mi trắng premium' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: 'Mô tả sản phẩm', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    enum: GarmentCategory,
    description: 'Phân loại trang phục',
    example: GarmentCategory.UPPER,
  })
  @IsEnum(GarmentCategory)
  category!: GarmentCategory;

  @ApiProperty({ description: 'Màu sắc', example: 'Trắng', required: false })
  @IsString()
  @IsOptional()
  color?: string;

  @ApiProperty({ description: 'Kích cỡ', example: 'L', required: false })
  @IsString()
  @IsOptional()
  size?: string;

  @ApiProperty({ description: 'Giá tiền VND', example: 350000 })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiProperty({
    description: 'URL ảnh garment. Không bắt buộc nếu upload file image.',
    example: 'https://example.com/garment.jpg',
    required: false,
  })
  @IsUrl()
  @IsOptional()
  garmentUrl?: string;

  @ApiProperty({ enum: ProductStatus, default: ProductStatus.ACTIVE, required: false })
  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;
}
