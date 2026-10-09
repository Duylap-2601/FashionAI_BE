import { ApiProperty } from "@nestjs/swagger";
import { OrderIssueReason, OrderIssueResolution } from "@prisma/client";
import { IsEnum, IsString, Length } from "class-validator";

export class CreateOrderIssueDto {
  @ApiProperty({
    enum: OrderIssueReason,
    description: "Nhóm lỗi: sai size, sai màu vải, chất lượng, hoặc khác",
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

  @ApiProperty({
    enum: OrderIssueResolution,
    description: "Mong muốn xử lý: hoàn tiền hoặc đổi 1-1",
  })
  @IsEnum(OrderIssueResolution)
  desiredResolution!: OrderIssueResolution;
}
