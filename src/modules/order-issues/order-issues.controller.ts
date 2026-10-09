import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Request } from "express";
import { Role } from "@prisma/client";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { FileValidationPipe } from "../../common/pipes/file-validation.pipe";
import { buildApiResponse } from "../../common/utils/api-response.util";
import { CreateOrderIssueDto } from "./dto/create-order-issue.dto";
import { QueryOrderIssueDto } from "./dto/query-order-issue.dto";
import { OrderIssuesService } from "./order-issues.service";

@ApiTags("OrderIssues")
@ApiBearerAuth("access-token")
@UseGuards(JwtAuthGuard)
@Controller("orders")
export class OrderIssuesController {
  constructor(private readonly orderIssuesService: OrderIssuesService) {}

  @Post(":orderId/items/:orderItemId/issues")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Báo lỗi sản phẩm trong đơn đã hoàn tất (kèm ảnh minh chứng)",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["reason", "description", "desiredResolution"],
      properties: {
        reason: {
          type: "string",
          enum: ["WRONG_SIZE", "WRONG_COLOR", "QUALITY_MISMATCH", "OTHER"],
        },
        description: {
          type: "string",
          example: "Áo bị lệch vai trái khoảng 4cm so với số đo đã đặt",
        },
        desiredResolution: { type: "string", enum: ["REFUND", "EXCHANGE"] },
        evidenceImages: {
          type: "array",
          items: { type: "string", format: "binary" },
          description:
            "Ảnh minh chứng lỗi (tối đa 10 ảnh, mỗi ảnh tối đa 10MB)",
        },
      },
    },
  })
  @UseInterceptors(AnyFilesInterceptor())
  async create(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param("orderId") orderId: string,
    @Param("orderItemId") orderItemId: string,
    @Body() dto: CreateOrderIssueDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const images = (files ?? []).filter((f) =>
      ["evidenceImages", "images", "image"].includes(f.fieldname),
    );

    if (images.length > 0) {
      const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
      for (const image of images) {
        filePipe.transform(image);
      }
    }

    const data = await this.orderIssuesService.create(
      user.id,
      orderId,
      orderItemId,
      dto,
      images,
    );
    return buildApiResponse(
      req,
      "ORDER_ISSUE_CREATE_SUCCESS",
      "Tạo yêu cầu xử lý thành công",
      data,
    );
  }

  @Get(":orderId/issues")
  @ApiOperation({
    summary:
      "Danh sách yêu cầu xử lý của đơn (user xem đơn của mình, admin xem mọi đơn)",
  })
  async findByOrder(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param("orderId") orderId: string,
    @Query() query: QueryOrderIssueDto,
  ) {
    const result = await this.orderIssuesService.findByOrder(
      orderId,
      user.id,
      user.role === Role.ADMIN,
      query,
    );
    return buildApiResponse(
      req,
      "ORDER_ISSUES_FETCH_SUCCESS",
      "Lấy danh sách yêu cầu xử lý thành công",
      result.items,
      result.meta,
    );
  }
}
