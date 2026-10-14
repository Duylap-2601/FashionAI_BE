import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { CART_MAX_QUANTITY } from '../constants/cart.constants';

export class UpdateCartItemDto {
  @ApiProperty({
    description: 'Số lượng cuối cùng của dòng (không phải số cộng thêm), gọi lại nhiều lần vẫn cùng kết quả',
    example: 2,
    minimum: 1,
    maximum: CART_MAX_QUANTITY,
  })
  @IsInt()
  @Min(1)
  @Max(CART_MAX_QUANTITY, { message: `Số lượng mỗi sản phẩm tối đa là ${CART_MAX_QUANTITY}` })
  quantity!: number;
}
