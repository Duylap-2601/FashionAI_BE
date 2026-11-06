import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FileValidationPipe } from '../../common/pipes/file-validation.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { StorageService } from '../storage/storage.service';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateMeasurementReviewDto, UpdateItemMeasurementDto, UpdateMeasurementReviewDto } from './dto/measurement-review.dto';
import { CreateDeliveryDisputeDto, ResolveDeliveryDisputeDto } from './dto/delivery-dispute.dto';
import { QueryAdminOrdersDto } from './dto/query-admin-orders.dto';
import { RefundOrderDto } from './dto/refund-order.dto';
import { CancelShipmentDto, CreateShipmentDto } from './dto/shipment.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ConfirmDeliveryDto } from './dto/confirm-delivery.dto';
import { OrdersService } from './orders.service';

const MAX_REFUND_RECEIPTS = 5;

@ApiTags('Orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly storageService: StorageService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Tạo đơn hàng sản phẩm' })
  async create(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
  ) {
    const data = await this.ordersService.create(user.id, dto);
    return buildApiResponse(req, 'ORDER_CREATE_SUCCESS', 'Tạo đơn hàng thành công', data);
  }

  @Post('quote')
  @ApiOperation({ summary: 'Tinh tong tien don hang tren backend' })
  async quote(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
  ) {
    const data = await this.ordersService.quote(user.id, dto);
    return buildApiResponse(req, 'ORDER_QUOTE_SUCCESS', 'Tinh tong tien don hang thanh cong', data);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách đơn hàng của tôi' })
  async findAll(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.ordersService.findAll(user.id, {
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      status,
      search,
    });
    return buildApiResponse(req, 'ORDERS_FETCH_SUCCESS', 'Lấy danh sách đơn hàng thành công', data.items, data.meta);
  }

  @Get('all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Danh sách tất cả đơn hàng (Admin Only)' })
  async findAllAdmin(@Req() req: Request, @Query() query: QueryAdminOrdersDto) {
    const data = await this.ordersService.findAllAdmin(query);
    return buildApiResponse(
      req,
      'ADMIN_ORDERS_FETCH_SUCCESS',
      'Lấy danh sách đơn hàng thành công',
      data.items,
      data.meta,
    );
  }

  @Get(':id/tracking')
  @ApiOperation({ summary: 'Theo dõi vận chuyển của đơn hàng' })
  async getTracking(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const data = await this.ordersService.getTracking(user.id, id);
    return buildApiResponse(req, 'ORDER_TRACKING_FETCH_SUCCESS', 'Lấy theo dõi vận chuyển thành công', data);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết đơn hàng (user xem đơn của mình, admin xem được mọi đơn)' })
  async findOne(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const data = await this.ordersService.findOne(user.id, id, user.role === Role.ADMIN);
    return buildApiResponse(req, 'ORDER_FETCH_SUCCESS', 'Lấy chi tiết đơn hàng thành công', data);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cập nhật trạng thái đơn hàng (Admin Only)' })
  async updateStatus(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const data = await this.ordersService.updateStatus(id, dto, user.id);
    return buildApiResponse(req, 'ORDER_STATUS_UPDATED', 'Cập nhật trạng thái đơn hàng thành công', data);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Hủy đơn hàng đang chờ xử lý' })
  async cancel(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const data = await this.ordersService.cancel(user.id, id);
    return buildApiResponse(req, 'ORDER_CANCEL_SUCCESS', 'Hủy đơn hàng thành công', data);
  }

  @Patch(':orderId/items/:itemId/measurement')
  @ApiOperation({ summary: 'Khách gửi lại snapshot số đo cho item có yêu cầu đang mở' })
  async updateItemMeasurement(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemMeasurementDto,
  ) {
    const data = await this.ordersService.updateItemMeasurement(user.id, orderId, itemId, dto);
    return buildApiResponse(req, 'ORDER_MEASUREMENT_UPDATED', 'Cập nhật số đo đơn hàng thành công', data);
  }

  @Post(':orderId/items/:itemId/measurement-review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin mở yêu cầu khách bổ sung số đo cho item' })
  async requestMeasurementReview(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: CreateMeasurementReviewDto,
  ) {
    const data = await this.ordersService.requestMeasurementReview(orderId, itemId, dto, user.id);
    return buildApiResponse(req, 'ORDER_MEASUREMENT_REVIEW_CREATED', 'Đã tạo yêu cầu bổ sung số đo', data);
  }

  @Patch(':orderId/items/:itemId/measurement-review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin sửa/mở lại yêu cầu khách chỉnh số đo cho item' })
  async updateMeasurementReview(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateMeasurementReviewDto,
  ) {
    const data = await this.ordersService.reopenMeasurementReview(orderId, itemId, dto, user.id);
    return buildApiResponse(req, 'ORDER_MEASUREMENT_REVIEW_UPDATED', 'Đã mở lại yêu cầu bổ sung số đo', data);
  }

  @Post(':id/delivery-dispute')
  @ApiOperation({ summary: 'Khách báo chưa nhận được hàng dù hãng vận chuyển đã báo giao' })
  @ApiConsumes('application/json', 'multipart/form-data')
  @UseInterceptors(AnyFilesInterceptor({
    limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 5 },
  }))
  async createDeliveryDispute(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateDeliveryDisputeDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const images = (files ?? []).filter((file) =>
      ['evidenceImages', 'images'].includes(file.fieldname),
    );
    if (images.length > 5) {
      throw new BadRequestException('Chỉ được đính kèm tối đa 5 ảnh minh chứng.');
    }
    const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
    const evidenceImages: string[] = [];
    for (const image of images) {
      filePipe.transform(image);
      evidenceImages.push(await this.storageService.uploadImage(image.buffer, 'delivery-disputes'));
    }
    const data = await this.ordersService.createDeliveryDispute(user.id, id, dto, evidenceImages);
    return buildApiResponse(req, 'DELIVERY_DISPUTE_CREATED', 'Đã ghi nhận báo chưa nhận hàng', data);
  }

  @Patch(':id/delivery-dispute')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin xử lý tranh chấp giao vận' })
  async resolveDeliveryDispute(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolveDeliveryDisputeDto,
  ) {
    const data = await this.ordersService.resolveDeliveryDispute(id, dto, user.id);
    return buildApiResponse(req, 'DELIVERY_DISPUTE_RESOLVED', 'Đã xử lý tranh chấp giao vận', data);
  }

  @Patch(':id/refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin cập nhật xử lý hoàn tiền (kèm ảnh chứng từ chuyển khoản)' })
  @ApiConsumes('application/json', 'multipart/form-data')
  @UseInterceptors(AnyFilesInterceptor())
  async updateRefund(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RefundOrderDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const receipts = (files ?? []).filter((file) =>
      ['receiptImages', 'receipts'].includes(file.fieldname),
    );
    if (receipts.length > MAX_REFUND_RECEIPTS) {
      throw new BadRequestException(
        `Chỉ được đính kèm tối đa ${MAX_REFUND_RECEIPTS} ảnh chứng từ chuyển khoản.`,
      );
    }

    const receiptImageUrls: string[] = [];
    if (receipts.length > 0) {
      const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
      for (const receipt of receipts) {
        filePipe.transform(receipt);
        receiptImageUrls.push(
          await this.storageService.uploadImage(receipt.buffer, 'refund-receipts'),
        );
      }
    }

    const data = await this.ordersService.updateRefund(
      id,
      dto,
      user.id,
      receiptImageUrls,
    );
    return buildApiResponse(req, 'ORDER_REFUND_UPDATED', 'Cập nhật hoàn tiền thành công', data);
  }

  @Post(':id/shipment')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin tạo vận đơn GHN cho đơn sẵn sàng giao' })
  async createShipment(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateShipmentDto,
  ) {
    const data = await this.ordersService.createShipment(id, dto, user.id);
    return buildApiResponse(req, 'ORDER_SHIPMENT_CREATED', 'Tạo vận đơn thành công', data);
  }

  @Post(':id/shipment/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin hủy vận đơn active' })
  async cancelShipment(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelShipmentDto,
  ) {
    const data = await this.ordersService.cancelShipment(id, dto, user.id);
    return buildApiResponse(req, 'ORDER_SHIPMENT_CANCELLED', 'Hủy vận đơn thành công', data);
  }

  @Post(':id/refund/confirm-received')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khách xác nhận đã nhận được tiền hoàn' })
  async confirmRefundReceived(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const data = await this.ordersService.confirmRefundReceived(user.id, id);
    return buildApiResponse(req, 'ORDER_REFUND_CONFIRMED', 'Đã xác nhận nhận tiền hoàn', data);
  }

  @Post(':id/confirm-delivery')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User xác nhận đã nhận hàng (chuyển từ DELIVERED → COMPLETED)' })
  async confirmDelivery(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ConfirmDeliveryDto,
  ) {
    const data = await this.ordersService.confirmDelivery(user.id, id, dto.note);
    return buildApiResponse(req, 'ORDER_DELIVERY_CONFIRMED', 'Xác nhận nhận hàng thành công', data);
  }
}
