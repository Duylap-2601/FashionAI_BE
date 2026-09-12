import {
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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateMeasurementReviewDto, UpdateItemMeasurementDto } from './dto/measurement-review.dto';
import { RefundOrderDto } from './dto/refund-order.dto';
import { CancelShipmentDto, CreateShipmentDto } from './dto/shipment.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

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
  async findAll(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.ordersService.findAll(user.id);
    return buildApiResponse(req, 'ORDERS_FETCH_SUCCESS', 'Lấy danh sách đơn hàng thành công', data);
  }

  @Get('all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Danh sách tất cả đơn hàng (Admin Only)' })
  async findAllAdmin(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.ordersService.findAllAdmin(
      Number(page) || 1,
      Number(limit) || 20,
    );
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
  @ApiOperation({ summary: 'Chi tiết đơn hàng' })
  async findOne(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const data = await this.ordersService.findOne(user.id, id);
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

  @Patch(':id/refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin cập nhật xử lý hoàn tiền' })
  async updateRefund(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RefundOrderDto,
  ) {
    const data = await this.ordersService.updateRefund(id, dto, user.id);
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
}
