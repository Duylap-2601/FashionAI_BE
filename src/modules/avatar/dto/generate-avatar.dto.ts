import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class GenerateAvatarDto {
  @ApiProperty({ enum: ['male', 'female'], example: 'female', description: 'Giá»›i tÃ­nh mannequin' })
  @IsIn(['male', 'female'])
  gender!: 'male' | 'female';

  @ApiProperty({ example: 165, description: 'Chiá»u cao (cm)' })
  @IsNumber()
  @Min(140)
  @Max(210)
  height!: number;

  @ApiProperty({ example: 56, description: 'CÃ¢n náº·ng (kg)' })
  @IsNumber()
  @Min(30)
  @Max(300)
  weight!: number;

  @ApiProperty({ example: 88, description: 'VÃ²ng ngá»±c (cm)' })
  @IsNumber()
  @Min(50)
  @Max(200)
  chest!: number;

  @ApiProperty({ example: 70, description: 'VÃ²ng eo (cm)' })
  @IsNumber()
  @Min(50)
  @Max(200)
  waist!: number;

  @ApiProperty({ example: 94, description: 'VÃ²ng hÃ´ng (cm)' })
  @IsNumber()
  @Min(50)
  @Max(200)
  hip!: number;

  @ApiProperty({ example: 39, description: 'Rá»™ng vai (cm)' })
  @IsNumber()
  @Min(30)
  @Max(80)
  shoulder!: number;

  @ApiProperty({ required: false, description: 'Báº­t Draco mesh compression (máº·c Ä‘á»‹nh true)' })
  @IsOptional()
  @IsBoolean()
  draco?: boolean;

  @ApiProperty({ required: false, description: 'Giá»¯ morph targets trong GLB (máº·c Ä‘á»‹nh true)' })
  @IsOptional()
  @IsBoolean()
  morph?: boolean;
}

