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

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cập nhật trạng thái đơn hàng (Admin Only)' })
  async updateStatus(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const data = await this.ordersService.updateStatus(id, dto.status);
    return buildApiResponse(req, 'ORDER_STATUS_UPDATED', 'Cập nhật trạng thái đơn hàng thành công', data);
  }
}
