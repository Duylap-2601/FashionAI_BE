import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UnregisterDeviceTokenDto {
  @ApiProperty({
    description: 'Expo push token cần xoá khỏi thiết bị hiện tại',
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  })
  @IsString()
  @IsNotEmpty({ message: 'token không được để trống' })
  @MaxLength(500)
  token!: string;
}
