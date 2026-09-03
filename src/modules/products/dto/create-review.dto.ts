import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ description: 'Đánh giá sao (1-5)', example: 5, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiProperty({ description: 'Nội dung đánh giá', required: false, example: 'Sản phẩm rất đẹp, vải tốt' })
  @IsString()
  @IsOptional()
  comment?: string;

  @ApiProperty({ description: 'Ảnh review (URL array)', required: false, type: [String] })
  @IsArray()
  @IsOptional()
  @IsUrl({}, { each: true })
  images?: string[];
}