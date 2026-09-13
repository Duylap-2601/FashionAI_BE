import { ApiPropertyOptional } from '@nestjs/swagger';
import { ShipmentStatus } from '@prisma/client';
import { IsBooleanString, IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryAdminShipmentsDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ enum: ShipmentStatus })
  @IsEnum(ShipmentStatus)
  @IsOptional()
  status?: ShipmentStatus;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  rawStatus?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  providerOrderCode?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  orderCode?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  customer?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  createdFrom?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  createdTo?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  expectedFrom?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  expectedTo?: string;

  @ApiPropertyOptional()
  @IsBooleanString()
  @IsOptional()
  issueOnly?: string;

  @ApiPropertyOptional()
  @IsBooleanString()
  @IsOptional()
  staleOnly?: string;
}
