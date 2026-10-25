import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MAX_TRY_ON_LAYERS } from '../utils/garment-combo.util';

export class LiveSessionItemDto {
  @ApiPropertyOptional({ description: 'ID sản phẩm (UUID)' })
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({ description: 'Tên màu đã chọn của sản phẩm' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  color?: string;
}

export class CreateLiveSessionDto {
  /**
   * Giữ lại cho client cũ chỉ thử 1 món. Khi gửi `items` thì bỏ qua field này.
   */
  @ApiPropertyOptional({ description: 'Chỉ thử 1 món. Dùng `items` cho combo.' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Màu của `productId`. Bỏ qua khi dùng `items`.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  color?: string;

  /**
   * Combo nhiều món. Decart chỉ nhận 1 ảnh tham chiếu mỗi phiên nên món lớp
   * ngoài sẽ cấp ảnh, các món còn lại được mô tả trong prompt.
   */
  @ApiPropertyOptional({
    description: `Combo tối đa ${MAX_TRY_ON_LAYERS} món, mỗi lớp mặc chỉ 1 món.`,
    type: [LiveSessionItemDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TRY_ON_LAYERS)
  @ValidateNested({ each: true })
  @Type(() => LiveSessionItemDto)
  items?: LiveSessionItemDto[];
}
