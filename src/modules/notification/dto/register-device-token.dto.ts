import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const DEVICE_TOKEN_PLATFORMS = ['ios', 'android'] as const;
export type DeviceTokenPlatform = (typeof DEVICE_TOKEN_PLATFORMS)[number];

export class RegisterDeviceTokenDto {
  @ApiProperty({
    description: 'Expo push token của thiết bị',
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  })
  @IsString()
  @IsNotEmpty({ message: 'token không được để trống' })
  @MaxLength(500)
  token!: string;

  @ApiProperty({ enum: DEVICE_TOKEN_PLATFORMS, example: 'android' })
  @IsIn(DEVICE_TOKEN_PLATFORMS, {
    message: `platform phải là một trong: ${DEVICE_TOKEN_PLATFORMS.join(', ')}`,
  })
  platform!: DeviceTokenPlatform;
}
