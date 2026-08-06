import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID } from 'class-validator';

export class StylistRequestDto {
  @ApiProperty({
    description:
      'Mô tả trang phục người dùng đang cân nhắc (tên, màu, chất liệu, kiểu dáng). Không bắt buộc nếu truyền productId.',
    example: 'Vest màu Navy Blue, chất liệu wool, kiểu dáng slim-fit',
    required: false,
  })
  @IsOptional()
  @IsString()
  garmentDescription?: string;

  @ApiProperty({
    description: 'ID sản phẩm thật từ catalog. Nếu truyền, backend sẽ lấy sản phẩm từ DB để tư vấn chính xác hơn.',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({
    description: 'Dịp mặc (ví dụ: công sở, dạ tiệc, casual)',
    example: 'Họp quan trọng tại văn phòng',
    required: false,
  })
  @IsOptional()
  @IsString()
  occasion?: string;

  @ApiProperty({
    description: 'Sở thích phong cách (minimal, lịch lãm, năng động, thanh lịch...)',
    example: 'Lịch lãm, tối giản',
    required: false,
  })
  @IsOptional()
  @IsString()
  stylePreference?: string;

  @ApiProperty({
    description: 'Ngân sách dự kiến cho outfit (VND)',
    example: 'Dưới 1 triệu đồng',
    required: false,
  })
  @IsOptional()
  @IsString()
  budget?: string;

  @ApiProperty({
    description: 'Giới tính ưu tiên tư vấn (male | female | other)',
    example: 'male',
    required: false,
  })
  @IsOptional()
  @IsString()
  genderPreference?: string;
}
