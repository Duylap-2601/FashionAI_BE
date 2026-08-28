import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ExchangeDto {
  @ApiProperty({ description: 'Authorization code từ Google OAuth redirect' })
  @IsString()
  code!: string;
}
