import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateLiveSessionDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsString()
  color?: string;
}
