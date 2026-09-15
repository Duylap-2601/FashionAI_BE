import { IsOptional, IsString, MaxLength } from 'class-validator';

export class EndLiveSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reason?: string;
}
