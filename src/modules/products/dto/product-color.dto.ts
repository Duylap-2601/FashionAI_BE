import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class ProductColorDto {
  @ApiProperty({ description: 'Tên màu', example: 'Trắng' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: 'Mã màu hex (#RRGGBB)', example: '#FFFFFF' })
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'hex phải đúng format #RRGGBB' })
  hex!: string;
}
