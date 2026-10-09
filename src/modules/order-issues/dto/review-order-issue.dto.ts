import { ApiProperty } from "@nestjs/swagger";
import { OrderIssueResolution } from "@prisma/client";
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class ReviewOrderIssueDto {
  @ApiProperty({
    enum: ["APPROVE", "REJECT"],
    description: "APPROVE: đồng ý xử lý; REJECT: từ chối yêu cầu",
  })
  @IsIn(["APPROVE", "REJECT"])
  decision!: "APPROVE" | "REJECT";

  @ApiProperty({
    enum: OrderIssueResolution,
    required: false,
    description:
      "Hướng xử lý cuối cùng (bắt buộc khi APPROVE; admin có thể đổi khác ý khách)",
  })
  @IsEnum(OrderIssueResolution)
  @IsOptional()
  approvedResolution?: OrderIssueResolution;

  @ApiProperty({
    required: false,
    description: "Ghi chú admin (bắt buộc khi REJECT)",
  })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  adminNote?: string;
}
