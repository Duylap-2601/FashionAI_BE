import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateOrderItemDto {
  @ApiProperty({ description: 'Product ID' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ description: 'Số lượng', example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: 'Size đã chọn', required: false, example: 'M' })
  @IsString()
  @IsOptional()
  size?: string;

  @ApiProperty({ description: 'Màu đã chọn', required: false, example: 'Black' })
  @IsString()
  @IsOptional()
  color?: string;
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
}

export class CreateOrderDto {
  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @ApiProperty({ type: ShippingInfoDto })
  @ValidateNested()
  @Type(() => ShippingInfoDto)
  shippingInfo!: ShippingInfoDto;
}
