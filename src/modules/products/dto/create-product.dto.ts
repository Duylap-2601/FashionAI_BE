import { ApiProperty } from '@nestjs/swagger';
import { GarmentCategory, ProductStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  IsInt,
} from 'class-validator';

// Khi gửi qua multipart/form-data, mảng được truyền dưới dạng chuỗi JSON.
// Helper này parse chuỗi -> mảng; nếu không phải chuỗi (đã là mảng) thì giữ nguyên.
const parseJsonArray = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

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

  @ApiProperty({ description: 'Giá tiền VND', example: 350000 })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiProperty({ description: 'Giá gốc (trước giảm giá)', required: false, example: 450000 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  originalPrice?: number;

  @ApiProperty({ description: 'Số lượng tồn kho', required: false, example: 100, default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  stock?: number;

  @ApiProperty({ description: 'Thương hiệu', required: false, example: 'StAle. SIGNATURE' })
  @IsString()
  @IsOptional()
  brand?: string;

  @ApiProperty({ description: 'Danh sách màu sắc', required: false, type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, hex: { type: 'string' } } } })
  @IsOptional()
  @Transform(parseJsonArray)
  @IsArray()
  colors?: Array<{ name: string; hex: string }>;

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
