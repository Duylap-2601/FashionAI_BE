import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class RefundPaymentDto {
  @ApiProperty({ example: 49000 })
  @IsInt()
  @Min(1)
  amountVnd!: number;

  @ApiProperty({ example: 'Customer refund request' })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiProperty({ required: false, description: 'Client/admin supplied idempotency key. UUID recommended.' })
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}
