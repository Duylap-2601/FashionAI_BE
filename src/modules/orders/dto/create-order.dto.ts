import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateOrderItemDto {
  @ApiProperty({ description: 'Product ID (UUID)' })
  @IsUUID('4', { message: 'productId phải là UUID hợp lệ' })
  productId!: string;

  @ApiProperty({ description: 'Số lượng', example: 1, minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000, { message: 'Số lượng mỗi sản phẩm tối đa là 1000' })
  quantity!: number;

  @ApiProperty({ description: 'Size đã chọn', required: false, example: 'M' })
  @IsString()
  @IsOptional()
  size?: string;

  @ApiProperty({ description: 'Màu đã chọn', required: false, example: 'Black' })
  @IsString()
  @IsOptional()
  color?: string;

  @ApiProperty({
    description:
      'Giá tham khảo từ FE. BE BỎ QUA và luôn dùng giá trong DB để tránh gian lận giá.',
    required: false,
    example: 750000,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  price?: number;
}

export class ShippingInfoDto {
  @ApiProperty({ example: 'Nguyen Van A' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: '0900000000' })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiProperty({ example: '123 Nguyen Trai, Quan 1, TP.HCM' })
  @IsString()
  @IsNotEmpty()
  address!: string;

  @ApiProperty({ required: false, example: 'Giao giờ hành chính' })
  @IsString()
  @IsOptional()
  note?: string;

  @ApiProperty({ required: false, example: 'Giao giờ hành chính' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateOrderDto {
  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50, { message: 'Đơn hàng tối đa 50 dòng sản phẩm' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @ApiProperty({ type: ShippingInfoDto })
  @ValidateNested()
  @Type(() => ShippingInfoDto)
  shippingInfo!: ShippingInfoDto;

  @ApiProperty({ description: 'Phương thức thanh toán', enum: ['COD', 'BANK', 'EWALLET'], example: 'COD', required: false })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiProperty({ description: 'Mã giảm giá', required: false, example: 'WELCOME' })
  @IsString()
  @IsOptional()
  couponCode?: string;

  @ApiProperty({ description: 'Số tiền giảm giá', required: false, example: 100000 })
  @IsInt()
  @Min(0)
  @IsOptional()
  discountAmount?: number;

  @ApiProperty({ description: 'Phí vận chuyển', required: false, example: 50000 })
  @IsInt()
  @Min(0)
  @IsOptional()
  shippingFee?: number;

  @ApiProperty({ description: 'Tổng tiền đơn hàng (để double check)', required: false, example: 1290000 })
  @IsInt()
  @Min(0)
  @IsOptional()
  totalAmount?: number;
}
