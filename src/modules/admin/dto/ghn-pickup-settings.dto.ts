import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class UpdateGhnPickupSettingsDto {
  @ApiProperty({ example: 202 })
  @IsInt()
  @Min(1)
  provinceId!: number;

  @ApiProperty({ example: 1685 })
  @IsInt()
  @Min(1)
  districtId!: number;

  @ApiProperty({ example: '90751' })
  @IsString()
  wardCode!: string;
}
