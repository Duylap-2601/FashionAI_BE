import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CalculateShippingFeeDto {
  @ApiProperty({ example: 1444 })
  @IsInt()
  toDistrictId!: number;

  @ApiProperty({ example: '20308' })
  @IsString()
  toWardCode!: string;

  @ApiProperty({ example: 600 })
  @IsInt()
  @Min(1)
  @Max(30000)
  weight!: number;

  @ApiProperty({ example: 25, required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  length?: number;

  @ApiProperty({ example: 20, required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  width?: number;

  @ApiProperty({ example: 8, required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  height?: number;

  @ApiProperty({ example: 850000, required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  insuranceValue?: number;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  codAmount?: number;
}
