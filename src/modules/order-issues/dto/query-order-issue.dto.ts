import { ApiProperty } from "@nestjs/swagger";
import { OrderIssueReason, OrderIssueStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Min } from "class-validator";

export class QueryOrderIssueDto {
  @ApiProperty({ enum: OrderIssueStatus, required: false })
  @IsEnum(OrderIssueStatus)
  @IsOptional()
  status?: OrderIssueStatus;

  @ApiProperty({ enum: OrderIssueReason, required: false })
  @IsEnum(OrderIssueReason)
  @IsOptional()
  reason?: OrderIssueReason;

  @ApiProperty({ required: false, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiProperty({ required: false, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 20;
}
