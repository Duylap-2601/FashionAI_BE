import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OrderIssueResolution } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

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

  @ApiPropertyOptional({
    description:
      "Có hoàn phí ship ban đầu không (khoản hoàn riêng, mỗi đơn một lần). Bỏ trống: hoàn khi lỗi từ phía shop.",
  })
  // Form multipart gửi "true"/"false" dạng chuỗi; đọc giá trị gốc vì chuyển kiểu ngầm
  // biến chuỗi "false" thành true.
  @Transform(({ obj, key }) => {
    const raw = (obj as Record<string, unknown>)[key];
    return raw === undefined || raw === "" ? undefined : raw === true || raw === "true";
  })
  @IsBoolean()
  @IsOptional()
  refundShipping?: boolean;

  @ApiPropertyOptional({
    description:
      "Duyệt và hoàn tiền ngay, không cần khách gửi trả hàng. Bắt buộc kèm evidenceReference và ảnh chứng từ.",
  })
  @Transform(({ obj, key }) => {
    const raw = (obj as Record<string, unknown>)[key];
    return raw === undefined || raw === "" ? undefined : raw === true || raw === "true";
  })
  @IsBoolean()
  @IsOptional()
  refundNow?: boolean;

  @ApiPropertyOptional({ description: "Mã giao dịch / ghi chú chuyển khoản khi hoàn tiền ngay" })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  evidenceReference?: string;
}
