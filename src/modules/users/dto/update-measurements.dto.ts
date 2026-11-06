import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { MEASUREMENT_RANGES } from '../../../common/constants/measurement.constants';

export class UpdateMeasurementsDto {
  @ApiProperty({ example: 170, required: false })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.height.min)
  @Max(MEASUREMENT_RANGES.height.max)
  height?: number;

  @ApiProperty({ example: 60, required: false })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.weight.min)
  @Max(MEASUREMENT_RANGES.weight.max)
  weight?: number;

  @ApiProperty({ example: 88, required: false })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.chest.min)
  @Max(MEASUREMENT_RANGES.chest.max)
  chest?: number;

  @ApiProperty({ example: 70, required: false })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.waist.min)
  @Max(MEASUREMENT_RANGES.waist.max)
  waist?: number;

  @ApiProperty({ example: 92, required: false })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.hip.min)
  @Max(MEASUREMENT_RANGES.hip.max)
  hip?: number;

  @ApiProperty({ example: 40, required: false })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.shoulder.min)
  @Max(MEASUREMENT_RANGES.shoulder.max)
  shoulder?: number;

  @ApiProperty({ example: 39, required: false, description: 'Vòng cổ (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.neck.min)
  @Max(MEASUREMENT_RANGES.neck.max)
  neck?: number;

  @ApiProperty({ example: 62, required: false, description: 'Dài tay áo (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.sleeveLength.min)
  @Max(MEASUREMENT_RANGES.sleeveLength.max)
  sleeveLength?: number;

  @ApiProperty({ example: 17, required: false, description: 'Vòng cổ tay (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.wrist.min)
  @Max(MEASUREMENT_RANGES.wrist.max)
  wrist?: number;

  @ApiProperty({ example: 54, required: false, description: 'Vòng đùi (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.thigh.min)
  @Max(MEASUREMENT_RANGES.thigh.max)
  thigh?: number;

  @ApiProperty({ example: 38, required: false, description: 'Vòng đầu gối (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.knee.min)
  @Max(MEASUREMENT_RANGES.knee.max)
  knee?: number;

  @ApiProperty({ example: 37, required: false, description: 'Vòng bắp chân (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.calf.min)
  @Max(MEASUREMENT_RANGES.calf.max)
  calf?: number;

  @ApiProperty({ example: 76, required: false, description: 'Dài đũng / Inseam (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.inseam.min)
  @Max(MEASUREMENT_RANGES.inseam.max)
  inseam?: number;

  @ApiProperty({ example: 99, required: false, description: 'Dài quần / Outseam (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.outseam.min)
  @Max(MEASUREMENT_RANGES.outseam.max)
  outseam?: number;

  @ApiProperty({ example: 71, required: false, description: 'Dài thân áo (cm)' })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.shirtLength.min)
  @Max(MEASUREMENT_RANGES.shirtLength.max)
  shirtLength?: number;

  @ApiProperty({ example: 82, required: false, description: 'Vòng ngực dưới (cm, cho nữ)' })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.underbust.min)
  @Max(MEASUREMENT_RANGES.underbust.max)
  underbust?: number;

  // ── Aliases for FE compatibility (bodyLength → shirtLength, trouserLength → outseam) ──
  @ApiProperty({ required: false, description: 'Dài thân áo (alias for shirtLength)' })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.shirtLength.min)
  @Max(MEASUREMENT_RANGES.shirtLength.max)
  @Transform(({ obj, key }) => obj[key] ?? obj.shirtLength)
  bodyLength?: number;

  @ApiProperty({ required: false, description: 'Dài quần (alias for outseam)' })
  @IsOptional()
  @IsNumber()
  @Min(MEASUREMENT_RANGES.outseam.min)
  @Max(MEASUREMENT_RANGES.outseam.max)
  @Transform(({ obj, key }) => obj[key] ?? obj.outseam)
  trouserLength?: number;
}
