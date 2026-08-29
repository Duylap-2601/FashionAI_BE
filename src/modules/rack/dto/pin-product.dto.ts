import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class PinProductDto {
  @ApiProperty({ description: 'ID sản phẩm cần pin vào giá treo đồ' })
  @IsUUID('4', { message: 'productId phải là UUID hợp lệ' })
  @IsNotEmpty()
  productId!: string;
}
