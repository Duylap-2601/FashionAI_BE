import { IsOptional, IsUUID } from 'class-validator';

export class ResumeLiveSessionDto {
  @IsOptional()
  @IsUUID()
  productId?: string;
}
