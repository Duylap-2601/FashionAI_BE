import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ required: false, description: 'Optional nếu refresh token đã nằm trong HttpOnly cookie' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
