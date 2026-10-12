import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class ResolveOrderIssueDto {
  @ApiProperty({
    required: false,
    description: "Ghi chú khi đánh dấu hoàn tất xử lý đổi hàng",
  })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  note?: string;
}
