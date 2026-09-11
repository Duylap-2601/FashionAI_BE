import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmManualPaymentDto {
  @ApiProperty({ description: 'Mã tham chiếu chuyển khoản / số tiền đối soát để tra soát sau này' })
  @IsString()
  @IsNotEmpty()
  reference!: string;

  @ApiProperty({ description: 'Lý do xác nhận thủ công, ví dụ căn cứ vào sao kê ngân hàng nào' })
  @IsString()
  @IsNotEmpty()
  note!: string;
}
