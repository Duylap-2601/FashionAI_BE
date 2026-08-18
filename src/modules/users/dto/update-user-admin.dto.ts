import { ApiProperty } from '@nestjs/swagger';
import { Role, UserTier } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class UpdateUserAdminDto {
  @ApiProperty({ enum: UserTier, required: false, description: 'Gói tài khoản' })
  @IsEnum(UserTier)
  @IsOptional()
  tier?: UserTier;

  @ApiProperty({ enum: Role, required: false, description: 'Vai trò hệ thống' })
  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @ApiProperty({ required: false, description: 'Trạng thái xác thực email' })
  @IsBoolean()
  @IsOptional()
  isVerified?: boolean;
}
