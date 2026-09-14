import { IsUUID } from 'class-validator';

export class CreateLiveSessionDto {
  @IsUUID()
  productId!: string;
}
