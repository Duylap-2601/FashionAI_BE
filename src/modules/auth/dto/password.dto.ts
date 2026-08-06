import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: 'Mật khẩu hiện tại' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ description: 'Mật khẩu mới (tối thiểu 8 ký tự)', minLength: 8 })
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Mật khẩu mới phải có ít nhất 8 ký tự' })
  newPassword!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ description: 'Email tài khoản cần khôi phục' })
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsNotEmpty()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token đặt lại mật khẩu nhận được qua email' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ description: 'Mật khẩu mới', minLength: 8 })
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Mật khẩu mới phải có ít nhất 8 ký tự' })
  newPassword!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token xác thực email nhận được qua email' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
