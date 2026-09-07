import { IsString, IsNotEmpty, IsBoolean, IsOptional, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCollectionDto {
  @ApiProperty({
    description: 'Collection name',
    example: 'Áo Dài 2026',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'URL-friendly slug (auto-generated from name if not provided)',
    example: 'ao-dai-2026',
  })
  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug?: string;

  @ApiProperty({
    description: 'Collection description',
    example: 'Thanh lịch, tinh tế cho mùa hè',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Publish status (whether visible on homepage)',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @ApiProperty({
    description: 'Display order for sorting on homepage',
    example: 1,
  })
  @IsOptional()
  displayOrder?: number;

  // Note: coverImages are uploaded as files via multipart/form-data
  // Field name: 'coverImages' (array of up to 3 files)
  // Validation happens in service after file upload
}
