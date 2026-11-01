import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class FinalizeRefundDto {
  @ApiProperty({
    enum: ['COMPLETED', 'FAILED'],
    description: 'Kết quả đối soát thủ công với cổng thanh toán',
  })
  @IsIn(['COMPLETED', 'FAILED'])
  outcome!: 'COMPLETED' | 'FAILED';

  @ApiProperty({ required: false, description: 'Ghi chú đối soát của admin' })
  @IsString()
  @IsOptional()
  note?: string;
}
