import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { COMBO_TYPES, ComboType } from '../../../common/constants/order.constants';
import { CART_MAX_QUANTITY } from '../constants/cart.constants';

export class AddCartItemDto {
  @ApiProperty({ description: 'ID sản phẩm' })
  @IsUUID('4', { message: 'productId phải là UUID hợp lệ' })
  productId!: string;

  @ApiProperty({ description: 'Số lượng thêm vào giỏ', example: 1, minimum: 1, maximum: CART_MAX_QUANTITY })
  @IsInt()
  @Min(1)
  @Max(CART_MAX_QUANTITY, { message: `Số lượng mỗi sản phẩm tối đa là ${CART_MAX_QUANTITY}` })
  quantity!: number;

  @ApiProperty({ description: 'Màu đã chọn', required: false, example: 'Black' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  color?: string;

  @ApiProperty({
    description: 'Phần combo suit khách chọn (chỉ áp dụng cho sản phẩm combo)',
    required: false,
    enum: COMBO_TYPES,
  })
  @IsIn(COMBO_TYPES, { message: `comboType phải là một trong: ${COMBO_TYPES.join(', ')}` })
  @IsOptional()
  comboType?: ComboType;
}
