import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateReviewDto {
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