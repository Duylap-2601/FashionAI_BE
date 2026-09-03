import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength } from 'class-validator';

export class UpdateReviewReplyDto {
  @ApiProperty({ example: 'Cập nhật: Cảm ơn bạn!', required: false, maxLength: 1000 })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  content?: string;
}