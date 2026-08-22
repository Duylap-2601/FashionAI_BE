import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, MaxLength, ValidateIf, IsNotEmpty } from 'class-validator';

export class ChatRequestDto {
  @ApiPropertyOptional({ example: 'uuid-session-id', description: 'ID phiên chat (null = tạo mới)' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiProperty({ example: 'Cho tôi tư vấn size áo sơ mi phù hợp', description: 'Tin nhắn của người dùng' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;

  @ApiPropertyOptional({ example: 'uuid-product-id', description: 'ID sản phẩm đang xem (context)' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Context bổ sung (measurements, preferences...)' })
  @IsOptional()
  context?: Record<string, any>;
}