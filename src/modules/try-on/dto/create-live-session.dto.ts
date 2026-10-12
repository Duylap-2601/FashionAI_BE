import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateLiveSessionDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  color?: string;
}
