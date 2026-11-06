import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SendOrderChatMessageDto {
  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @ApiProperty({ required: false, description: 'Idempotency key do client sinh để chống gửi trùng' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientMessageId?: string;
}

export class MarkOrderChatReadDto {
  @ApiProperty({ required: false, description: 'Đánh dấu đã đọc tới message này (mốc thời gian)' })
  @IsOptional()
  @IsString()
  upToMessageId?: string;
}
