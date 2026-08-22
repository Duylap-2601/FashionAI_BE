import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

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

  @ApiProperty({ example: 39, required: false, description: 'Vòng cổ (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(28)
  @Max(55)
  neck?: number;

  @ApiProperty({ example: 62, required: false, description: 'Dài tay áo (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(45)
  @Max(80)
  sleeveLength?: number;

  @ApiProperty({ example: 17, required: false, description: 'Vòng cổ tay (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(12)
  @Max(25)
  wrist?: number;

  @ApiProperty({ example: 54, required: false, description: 'Vòng đùi (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(35)
  @Max(90)
  thigh?: number;

  @ApiProperty({ example: 38, required: false, description: 'Vòng đầu gối (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(25)
  @Max(55)
  knee?: number;

  @ApiProperty({ example: 37, required: false, description: 'Vòng bắp chân (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(25)
  @Max(55)
  calf?: number;

  @ApiProperty({ example: 76, required: false, description: 'Dài đũng / Inseam (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(55)
  @Max(95)
  inseam?: number;

  @ApiProperty({ example: 99, required: false, description: 'Dài quần / Outseam (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(80)
  @Max(120)
  outseam?: number;

  @ApiProperty({ example: 71, required: false, description: 'Dài thân áo (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(85)
  shirtLength?: number;

  @ApiProperty({ example: 82, required: false, description: 'Vòng ngực dưới (cm, cho nữ)' })
  @IsOptional()
  @IsNumber()
  @Min(55)
  @Max(130)
  underbust?: number;

  // ── Aliases for FE compatibility (bodyLength → shirtLength, trouserLength → outseam) ──
  @ApiProperty({ required: false, description: 'Dài thân áo (alias for shirtLength)' })
  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(85)
  @Transform(({ obj, key }) => obj[key] ?? obj.shirtLength)
  bodyLength?: number;

  @ApiProperty({ required: false, description: 'Dài quần (alias for outseam)' })
  @IsOptional()
  @IsNumber()
  @Min(80)
  @Max(120)
  @Transform(({ obj, key }) => obj[key] ?? obj.outseam)
  trouserLength?: number;
}
