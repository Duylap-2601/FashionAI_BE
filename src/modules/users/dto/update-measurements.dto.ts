import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateMeasurementsDto {
  @ApiProperty({ example: 170, required: false })
  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(250)
  height?: number;

  @ApiProperty({ example: 60, required: false })
  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(300)
  weight?: number;

  @ApiProperty({ example: 88, required: false })
  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(200)
  chest?: number;

  @ApiProperty({ example: 70, required: false })
  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(200)
  waist?: number;

  @ApiProperty({ example: 92, required: false })
  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(200)
  hip?: number;

  @ApiProperty({ example: 40, required: false })
  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(80)
  shoulder?: number;
}
