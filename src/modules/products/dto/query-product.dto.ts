import { ApiProperty } from '@nestjs/swagger';
import { GarmentCategory, ProductStatus } from '@prisma/client';
import { IsEnum, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryProductDto {
  @ApiProperty({ required: false, description: 'Từ khóa tìm kiếm theo tên/mô tả' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiProperty({ enum: GarmentCategory, required: false })
  @IsEnum(GarmentCategory)
  @IsOptional()
  category?: GarmentCategory;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  color?: string;

  @ApiProperty({ required: false, description: 'Danh mục con, có thể truyền nhiều giá trị phân tách bằng dấu phẩy' })
  @IsString()
  @IsOptional()
  subCategory?: string;

  @ApiProperty({ required: false, description: 'Lọc theo chất liệu vải (tìm kiếm tương đối)' })
  @IsString()
  @IsOptional()
  material?: string;

  @ApiProperty({ required: false })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  minPrice?: number;

  @ApiProperty({ required: false })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxPrice?: number;

  @ApiProperty({ enum: ProductStatus, required: false })
  @IsEnum(ProductStatus)
  @IsOptional()
  status?: ProductStatus;

  @ApiProperty({ required: false, enum: ['latest', 'price_asc', 'price_desc'], default: 'latest' })
  @IsIn(['latest', 'price_asc', 'price_desc'])
  @IsOptional()
  sort?: 'latest' | 'price_asc' | 'price_desc' = 'latest';

  @ApiProperty({ required: false, default: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiProperty({ required: false, default: 20 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  limit?: number = 20;
}
