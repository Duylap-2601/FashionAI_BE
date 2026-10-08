import { ApiProperty } from '@nestjs/swagger';
import { GhnAddressModel } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpsertUserAddressDto {
  @ApiProperty({ enum: GhnAddressModel, required: false, default: GhnAddressModel.LEGACY_3_LEVEL })
  @IsEnum(GhnAddressModel)
  @IsOptional()
  addressModel?: GhnAddressModel;

  @ApiProperty({ example: 'Nguyen Van A' })
  @IsString()
  @MaxLength(100)
  recipientName!: string;

  @ApiProperty({ example: '0900000000' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ example: '123 Nguyen Trai' })
  @IsString()
  @MaxLength(255)
  addressLine!: string;

  @ApiProperty({ required: false, example: 'Nhà riêng' })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  label?: string;

  @ApiProperty({ example: 202 })
  @IsInt()
  @Min(1)
  @ValidateIf((dto: UpsertUserAddressDto) => (dto.addressModel ?? GhnAddressModel.LEGACY_3_LEVEL) === GhnAddressModel.LEGACY_3_LEVEL)
  ghnProvinceId!: number;

  @ApiProperty({ example: 1442 })
  @IsInt()
  @Min(1)
  @ValidateIf((dto: UpsertUserAddressDto) => (dto.addressModel ?? GhnAddressModel.LEGACY_3_LEVEL) === GhnAddressModel.LEGACY_3_LEVEL)
  ghnDistrictId!: number;

  @ApiProperty({ example: '21211' })
  @IsString()
  @MaxLength(20)
  @ValidateIf((dto: UpsertUserAddressDto) => (dto.addressModel ?? GhnAddressModel.LEGACY_3_LEVEL) === GhnAddressModel.LEGACY_3_LEVEL)
  ghnWardCode!: string;

  @ApiProperty({ required: false, example: '1000001' })
  @IsString()
  @MaxLength(50)
  @ValidateIf((dto: UpsertUserAddressDto) => dto.addressModel === GhnAddressModel.POST_MERGER_2_LEVEL)
  ghnProvinceV3Id?: string;

  @ApiProperty({ required: false, example: '1003646' })
  @IsString()
  @MaxLength(50)
  @ValidateIf((dto: UpsertUserAddressDto) => dto.addressModel === GhnAddressModel.POST_MERGER_2_LEVEL)
  ghnWardV3Id?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiProperty({ required: false, description: 'Required for PATCH concurrency check' })
  @IsInt()
  @Min(1)
  @IsOptional()
  expectedVersion?: number;
}
