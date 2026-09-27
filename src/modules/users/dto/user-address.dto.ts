import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpsertUserAddressDto {
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
  ghnProvinceId!: number;

  @ApiProperty({ example: 1442 })
  @IsInt()
  @Min(1)
  ghnDistrictId!: number;

  @ApiProperty({ example: '21211' })
  @IsString()
  @MaxLength(20)
  ghnWardCode!: string;

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
