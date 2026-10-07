import { ApiProperty } from '@nestjs/swagger';
import { GarmentCategory, ProductStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  ValidateNested,
} from 'class-validator';
import { GarmentType } from '../../../common/constants/measurement.constants';
import { ProductColorDto } from './product-color.dto';

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

  @ApiProperty({
    enum: GarmentType,
    description: 'Loại trang phục cụ thể (dùng để xác định số đo cần thiết khi đặt may)',
    example: GarmentType.SHIRT,
    required: false,
  })
  @IsEnum(GarmentType)
  @IsOptional()
  garmentType?: GarmentType;

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

  @ApiProperty({ description: 'Thương hiệu', required: false, example: 'StAle. SIGNATURE' })
  @IsString()
  @IsOptional()
  brand?: string;

  @ApiProperty({ description: 'Chất liệu vải', required: false, example: 'Cotton 100%' })
  @IsString()
  @IsOptional()
  material?: string;

  @ApiProperty({ description: 'Danh sách màu sắc', required: false, type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, hex: { type: 'string' } } } })
  @IsOptional()
  @Transform(parseJsonArray)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductColorDto)
  colors?: ProductColorDto[];

  @ApiProperty({
    description:
      'Mảng song song với images[] theo đúng thứ tự upload: tên màu (phải khớp 1 trong colors[].name) cho từng ảnh, hoặc null nếu ảnh đó là ảnh chung không gắn màu',
    required: false,
    type: 'array',
    items: { type: 'string', nullable: true },
  })
  @IsOptional()
  @Transform(parseJsonArray)
  @IsArray()
  imageColors?: Array<string | null>;

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

  // Files từ FilesInterceptor; không validate bằng class-validator, chỉ mark để skip forbidNonWhitelisted
  @IsOptional()
  images?: unknown;

  @IsOptional()
  image?: unknown;

  @IsOptional()
  isMainIndex?: unknown;
}
