import { ApiProperty } from '@nestjs/swagger';
import { GhnAddressModel } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';

export class UpdateGhnPickupSettingsDto {
  @ApiProperty({ enum: GhnAddressModel, required: false, default: GhnAddressModel.POST_MERGER_2_LEVEL })
  @IsEnum(GhnAddressModel)
  @IsOptional()
  addressModel?: GhnAddressModel;

  @ApiProperty({ example: 202, required: false })
  @IsInt()
  @Min(1)
  @ValidateIf((dto: UpdateGhnPickupSettingsDto) => (dto.addressModel ?? GhnAddressModel.POST_MERGER_2_LEVEL) === GhnAddressModel.LEGACY_3_LEVEL)
  provinceId?: number;

  @ApiProperty({ example: 1685, required: false })
  @IsInt()
  @Min(1)
  @ValidateIf((dto: UpdateGhnPickupSettingsDto) => (dto.addressModel ?? GhnAddressModel.POST_MERGER_2_LEVEL) === GhnAddressModel.LEGACY_3_LEVEL)
  districtId?: number;

  @ApiProperty({ example: '90751', required: false })
  @IsString()
  @ValidateIf((dto: UpdateGhnPickupSettingsDto) => (dto.addressModel ?? GhnAddressModel.POST_MERGER_2_LEVEL) === GhnAddressModel.LEGACY_3_LEVEL)
  wardCode?: string;

  @ApiProperty({ example: '1000001', required: false })
  @IsString()
  @ValidateIf((dto: UpdateGhnPickupSettingsDto) => (dto.addressModel ?? GhnAddressModel.POST_MERGER_2_LEVEL) === GhnAddressModel.POST_MERGER_2_LEVEL)
  provinceV3Id?: string;

  @ApiProperty({ example: '1003575', required: false })
  @IsString()
  @ValidateIf((dto: UpdateGhnPickupSettingsDto) => (dto.addressModel ?? GhnAddressModel.POST_MERGER_2_LEVEL) === GhnAddressModel.POST_MERGER_2_LEVEL)
  wardV3Id?: string;
}
