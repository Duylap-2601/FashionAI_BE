import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminStatsService } from './admin-stats.service';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { AdminSettingsService } from './admin-settings.service';
import { UpdateGhnPickupSettingsDto } from './dto/ghn-pickup-settings.dto';

@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly statsService: AdminStatsService,
    private readonly settingsService: AdminSettingsService,
  ) {}

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Thống kê tổng quan hệ thống (Admin Only)' })
  async getStats(@Req() req: Request) {
    const data = await this.statsService.getStats();
    return buildApiResponse(req, 'ADMIN_STATS_SUCCESS', 'Lấy thống kê hệ thống thành công', data);
  }

  @Get('settings/ghn-pickup')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Lấy cấu hình địa chỉ lấy hàng GHN (Admin Only)' })
  async getGhnPickupSettings(@Req() req: Request) {
    const data = await this.settingsService.getGhnPickupSettings();
    return buildApiResponse(req, 'ADMIN_GHN_PICKUP_SETTINGS_FETCHED', 'Lấy cấu hình GHN thành công', data);
  }

  @Put('settings/ghn-pickup')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Cập nhật địa chỉ lấy hàng GHN (Admin Only)' })
  async updateGhnPickupSettings(@Req() req: Request, @Body() dto: UpdateGhnPickupSettingsDto) {
    const data = await this.settingsService.updateGhnPickupSettings(dto);
    return buildApiResponse(req, 'ADMIN_GHN_PICKUP_SETTINGS_UPDATED', 'Cập nhật cấu hình GHN thành công', data);
  }
}
