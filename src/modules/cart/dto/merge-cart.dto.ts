import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';
import { CART_MAX_LINES } from '../constants/cart.constants';
import { AddCartItemDto } from './add-cart-item.dto';

export class MergeCartDto {
  @ApiProperty({ type: [AddCartItemDto], description: 'Giỏ hàng khách (chưa đăng nhập) lưu trên thiết bị' })
  @IsArray()
  @ArrayMaxSize(CART_MAX_LINES, { message: `Giỏ hàng tối đa ${CART_MAX_LINES} dòng sản phẩm` })
  @ValidateNested({ each: true })
  @Type(() => AddCartItemDto)
  items!: AddCartItemDto[];
}
