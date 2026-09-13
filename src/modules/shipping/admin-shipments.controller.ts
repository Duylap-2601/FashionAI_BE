import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AdminShipmentsService } from './admin-shipments.service';
import { CancelAdminShipmentDto } from './dto/cancel-admin-shipment.dto';
import { QueryAdminShipmentsDto } from './dto/query-admin-shipments.dto';

@ApiTags('Admin Shipments')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/shipments')
export class AdminShipmentsController {
  constructor(private readonly adminShipmentsService: AdminShipmentsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách vận đơn cho admin' })
  async findAll(@Req() req: Request, @Query() query: QueryAdminShipmentsDto) {
    const data = await this.adminShipmentsService.findAll(query);
    return buildApiResponse(req, 'ADMIN_SHIPMENTS_FETCH_SUCCESS', 'Lấy danh sách vận đơn thành công', data.items, data.meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết vận đơn cho admin' })
  async findOne(@Req() req: Request, @Param('id') id: string) {
    const data = await this.adminShipmentsService.findOne(id);
    return buildApiResponse(req, 'ADMIN_SHIPMENT_FETCH_SUCCESS', 'Lấy chi tiết vận đơn thành công', data);
  }

  @Post(':id/sync')
  @ApiOperation({ summary: 'Đồng bộ trạng thái GHN cho vận đơn' })
  async sync(@Req() req: Request, @Param('id') id: string) {
    const data = await this.adminShipmentsService.sync(id);
    return buildApiResponse(req, 'ADMIN_SHIPMENT_SYNCED', 'Đồng bộ vận đơn thành công', data);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Hủy vận đơn GHN' })
  async cancel(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelAdminShipmentDto,
  ) {
    const data = await this.adminShipmentsService.cancel(id, dto, user.id);
    return buildApiResponse(req, 'ADMIN_SHIPMENT_CANCELLED', 'Hủy vận đơn thành công', data);
  }
}
