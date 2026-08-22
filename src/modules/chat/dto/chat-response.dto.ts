import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatMessageDto {
  @ApiProperty({ example: 'uuid-message-id' })
  id!: string;

  @ApiProperty({ enum: ['user', 'assistant', 'system'] })
  role!: 'user' | 'assistant' | 'system';

  @ApiProperty()
  content!: string;

  @ApiPropertyOptional()
  tokensIn?: number;

  @ApiPropertyOptional()
  tokensOut?: number;

  @ApiPropertyOptional()
  model?: string;

  @ApiProperty()
  createdAt!: Date;
}

export class ChatSessionDto {
  @ApiProperty({ example: 'uuid-session-id' })
  id!: string;

  @ApiPropertyOptional({ example: 'Tư vấn size blazer công sở' })
  title?: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({ type: [ChatMessageDto] })
  messages!: ChatMessageDto[];
}

export class ChatSessionListDto {
  @ApiProperty({ example: 'uuid-session-id' })
  id!: string;

  @ApiPropertyOptional({ example: 'Tư vấn size blazer công sở' })
  title?: string;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({ example: 'Cho tôi tư vấn size...' })
  lastMessage!: string;

  @ApiProperty({ enum: ['user', 'assistant'] })
  lastRole!: 'user' | 'assistant';
}