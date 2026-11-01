import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OrderIssueReason, OrderIssueResolution } from "@prisma/client";
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from "class-validator";

export class CreateOrderIssueDto {
  @ApiProperty({
    enum: OrderIssueReason,
    description:
      "Nhóm lỗi: sai size, sai màu vải, chất lượng, khác, hoặc chưa nhận được tiền hoàn",
  })
  @IsEnum(OrderIssueReason)
  reason!: OrderIssueReason;

  @ApiProperty({
    description: "Mô tả chi tiết lỗi khách gặp phải",
    example: "Áo bị lệch vai trái khoảng 4cm so với số đo đã đặt",
  })
  @IsString()
  @Length(10, 2000, { message: "Mô tả phải từ 10 đến 2000 ký tự" })
  description!: string;

  @ApiPropertyOptional({
    enum: [OrderIssueResolution.REFUND],
    description:
      "Hướng xử lý. Hệ thống chỉ hỗ trợ hoàn tiền, admin không còn duyệt đổi hàng.",
  })
  @IsIn([OrderIssueResolution.REFUND], {
    message: "Chỉ hỗ trợ hướng xử lý hoàn tiền (REFUND)",
  })
  @IsOptional()
  desiredResolution?: OrderIssueResolution;

  @ApiProperty({
    example: "Vietcombank",
    description: "Tên ngân hàng nhận hoàn tiền",
  })
  @IsString()
  @IsNotEmpty({ message: "Vui lòng nhập tên ngân hàng nhận hoàn tiền" })
  @MaxLength(120)
  bankName!: string;

  @ApiProperty({
    example: "0123456789",
    description: "Số tài khoản nhận hoàn tiền",
  })
  @Matches(/^[0-9]{6,20}$/, { message: "Số tài khoản phải gồm 6-20 chữ số" })
  accountNumber!: string;

  @ApiProperty({
    example: "NGUYEN VAN A",
    description: "Tên chủ tài khoản",
  })
  @IsString()
  @IsNotEmpty({ message: "Vui lòng nhập tên chủ tài khoản" })
  @MaxLength(120)
  accountHolder!: string;
}
