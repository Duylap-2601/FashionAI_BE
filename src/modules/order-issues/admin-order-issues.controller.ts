import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { Role } from "@prisma/client";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { RolesGuard } from "../../common/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { buildApiResponse } from "../../common/utils/api-response.util";
import { QueryOrderIssueDto } from "./dto/query-order-issue.dto";
import { ResolveOrderIssueDto } from "./dto/resolve-order-issue.dto";
import { ReviewOrderIssueDto } from "./dto/review-order-issue.dto";
import { OrderIssuesService } from "./order-issues.service";

@ApiTags("OrderIssues")
@ApiBearerAuth("access-token")
@UseGuards(JwtAuthGuard)
@Controller("order-issues")
export class AdminOrderIssuesController {
  constructor(private readonly orderIssuesService: OrderIssuesService) {}

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
  async review(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param("issueId") issueId: string,
    @Body() dto: ReviewOrderIssueDto,
  ) {
    const data = await this.orderIssuesService.review(issueId, user.id, dto);
    return buildApiResponse(
      req,
      "ORDER_ISSUE_REVIEWED",
      "Xét duyệt yêu cầu thành công",
      data,
    );
  }

  @Patch(":issueId/resolve")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: "Admin đánh dấu đổi hàng hoàn tất (sau khi ship thủ công)",
  })
  async resolve(
    @Req() req: Request,
    @Param("issueId") issueId: string,
    @Body() dto: ResolveOrderIssueDto,
  ) {
    const data = await this.orderIssuesService.resolve(issueId, dto);
    return buildApiResponse(
      req,
      "ORDER_ISSUE_RESOLVED",
      "Hoàn tất xử lý yêu cầu thành công",
      data,
    );
  }
}
