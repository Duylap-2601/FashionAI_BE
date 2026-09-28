import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class MomoIpnDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  partnerCode!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  requestId!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  amount!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  resultCode!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  transId?: string | number;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  responseTime?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  orderInfo?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  orderType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  payType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  extraData?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  signature!: string;
}
