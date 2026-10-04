import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export class UpdateReviewDto {
  @ApiProperty({ description: 'Đánh giá sao (1-5)', required: false, example: 4, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  rating?: number;

  @ApiProperty({ description: 'Nội dung đánh giá', required: false, example: 'Cập nhật: sản phẩm vẫn tốt sau nhiều lần giặt' })
  @IsString()
  @IsOptional()
  comment?: string;

  @ApiProperty({ description: 'Ảnh review (URL array)', required: false, type: [String] })
  @IsArray()
  @IsOptional()
  @IsUrl({}, { each: true })
  images?: string[];
}