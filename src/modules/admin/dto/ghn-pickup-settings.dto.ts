import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateGhnPickupSettingsDto {
  @ApiProperty({ example: '1000001' })
  @IsString()
  @MaxLength(50)
  provinceV3Id!: string;

  @ApiProperty({ example: '1003575' })
  @IsString()
  @MaxLength(50)
  wardV3Id!: string;

  @ApiProperty({ required: false, example: 'Long Thạnh Mỹ' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  addressLine?: string;
}
