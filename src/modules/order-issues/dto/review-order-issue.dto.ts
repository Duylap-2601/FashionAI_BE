import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OrderIssueResolution } from "@prisma/client";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class ReviewOrderIssueDto {
  @ApiProperty({
    enum: ["APPROVE", "REJECT"],
    description: "APPROVE: đồng ý hoàn tiền; REJECT: từ chối yêu cầu",
  })
  @IsIn(["APPROVE", "REJECT"])
  decision!: "APPROVE" | "REJECT";

  @ApiPropertyOptional({
    enum: [OrderIssueResolution.REFUND],
    description: "Hướng xử lý duy nhất hiện hỗ trợ là hoàn tiền (REFUND)",
  })
  @IsIn([OrderIssueResolution.REFUND], {
    message: "Chỉ hỗ trợ duyệt hướng hoàn tiền (REFUND)",
  })
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
