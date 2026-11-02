import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { Request } from "express";
import { Role } from "@prisma/client";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { RolesGuard } from "../../common/guards/roles.guard";
import { FileValidationPipe } from "../../common/pipes/file-validation.pipe";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { StorageService } from "../storage/storage.service";
import { buildApiResponse } from "../../common/utils/api-response.util";
import { QueryOrderIssueDto } from "./dto/query-order-issue.dto";
import { ReviewOrderIssueDto } from "./dto/review-order-issue.dto";
import { OrderIssuesService } from "./order-issues.service";

const MAX_REVIEW_RECEIPTS = 5;

@ApiTags("OrderIssues")
@ApiBearerAuth("access-token")
@UseGuards(JwtAuthGuard)
@Controller("order-issues")
export class AdminOrderIssuesController {
  constructor(
    private readonly orderIssuesService: OrderIssuesService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: "Danh sách mọi yêu cầu xử lý (Admin Only, lọc status/reason)",
  })
  async findAllAdmin(@Req() req: Request, @Query() query: QueryOrderIssueDto) {
    const result = await this.orderIssuesService.findAllAdmin(query);
    return buildApiResponse(
      req,
      "ADMIN_ORDER_ISSUES_FETCH_SUCCESS",
      "Lấy danh sách yêu cầu xử lý thành công",
      result.items,
      result.meta,
    );
  }

  @Get(":issueId")
  @ApiOperation({ summary: "Chi tiết yêu cầu xử lý (chủ đơn hoặc admin)" })
  async findOne(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param("issueId") issueId: string,
  ) {
    const data = await this.orderIssuesService.findOne(
      issueId,
      user.id,
      user.role === Role.ADMIN,
    );
    return buildApiResponse(
      req,
      "ORDER_ISSUE_FETCH_SUCCESS",
      "Lấy chi tiết yêu cầu thành công",
      data,
    );
  }

  @Patch(":issueId/review")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: "Admin duyệt/từ chối yêu cầu xử lý" })
  @ApiConsumes("application/json", "multipart/form-data")
  @UseInterceptors(AnyFilesInterceptor())
  async review(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param("issueId") issueId: string,
    @Body() dto: ReviewOrderIssueDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const receipts = (files ?? []).filter((file) =>
      ["receiptImages", "receipts"].includes(file.fieldname),
    );
    if (receipts.length > MAX_REVIEW_RECEIPTS) {
      throw new BadRequestException(
        `Chỉ được đính kèm tối đa ${MAX_REVIEW_RECEIPTS} ảnh chứng từ.`,
      );
    }

    const receiptImageUrls: string[] = [];
    const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
    for (const receipt of receipts) {
      filePipe.transform(receipt);
      receiptImageUrls.push(
        await this.storageService.uploadImage(receipt.buffer, "refund-receipts"),
      );
    }

    const data = await this.orderIssuesService.review(
      issueId,
      user.id,
      dto,
      receiptImageUrls,
    );
    return buildApiResponse(
      req,
      "ORDER_ISSUE_REVIEWED",
      "Xét duyệt yêu cầu thành công",
      data,
    );
  }
}
