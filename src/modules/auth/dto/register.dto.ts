import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'Email không hợp lệ' })
  email!: string;

  @ApiProperty({ example: 'StrongPassword123' })
  @IsString({ message: 'Mật khẩu phải là chuỗi ký tự' })
  @MinLength(8, { message: 'Mật khẩu phải có ít nhất 8 ký tự' })
  password!: string;

  @ApiProperty({ example: 'StrongPassword123' })
  @IsString({ message: 'Mật khẩu xác nhận phải là chuỗi ký tự' })
  @MinLength(8, { message: 'Mật khẩu xác nhận phải có ít nhất 8 ký tự' })
  confirmPassword!: string;

  @ApiProperty({ example: 'Nguyen An', required: false })
  @IsOptional()
  @IsString({ message: 'Họ và tên phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  name?: string;
}
