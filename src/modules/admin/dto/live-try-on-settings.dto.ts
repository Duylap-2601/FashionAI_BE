import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

class LiveTryOnTierPolicyDto {
  @ApiProperty()
  @IsBoolean()
  liveEnabled!: boolean;

  @ApiProperty({ example: 120 })
  @IsInt()
  @Min(0)
  @Max(24 * 60 * 60)
  dailySeconds!: number;

  @ApiProperty({ example: 30 })
  @IsInt()
  @Min(0)
  @Max(60 * 60)
  maxSessionSeconds!: number;
}

class LiveTryOnTierPoliciesDto {
  @ValidateNested()
  @Type(() => LiveTryOnTierPolicyDto)
  FREE!: LiveTryOnTierPolicyDto;

  @ValidateNested()
  @Type(() => LiveTryOnTierPolicyDto)
  MEMBER!: LiveTryOnTierPolicyDto;

  @ValidateNested()
  @Type(() => LiveTryOnTierPolicyDto)
  VIP!: LiveTryOnTierPolicyDto;
}

export class UpdateLiveTryOnSettingsDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ example: 12000 })
  @IsInt()
  @Min(0)
  globalDailyCredits!: number;

  @ApiProperty({ example: 5 })
  @IsInt()
  @Min(1)
  @Max(100)
  maxConcurrentSessions!: number;

  @ApiProperty({ example: 300 })
  @IsInt()
  @Min(15)
  @Max(24 * 60 * 60)
  pauseTimeoutSeconds!: number;

  @ApiProperty({ example: ['UPPER', 'LOWER', 'FULL_BODY'] })
  @IsArray()
  @IsIn(['UPPER', 'LOWER', 'FULL_BODY'], { each: true })
  allowedCategories!: Array<'UPPER' | 'LOWER' | 'FULL_BODY'>;

  @ApiPropertyOptional({ example: [] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  betaUserIds?: string[];

  @ApiPropertyOptional({ example: [] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  betaProductIds?: string[];

  @ApiProperty()
  @IsObject()
  @ValidateNested()
  @Type(() => LiveTryOnTierPoliciesDto)
  tiers!: LiveTryOnTierPoliciesDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  version?: number;
}
