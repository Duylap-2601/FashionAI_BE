import { IsString, IsBoolean, IsOptional, Matches, IsNumber, IsArray } from 'class-validator';
import { PartialType, ApiProperty } from '@nestjs/swagger';
import { CreateCollectionDto } from './create-collection.dto';

export class UpdateCollectionDto extends PartialType(CreateCollectionDto) {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @IsNumber()
  @IsOptional()
  displayOrder?: number;

  @ApiProperty({
    description: 'Array of cover image URLs (when not uploading files)',
    example: ['https://example.com/cover1.jpg'],
    required: false,
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  coverImages?: string[];
}
