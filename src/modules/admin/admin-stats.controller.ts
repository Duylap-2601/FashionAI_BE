import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminStatsService } from './admin-stats.service';

@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly statsService: AdminStatsService) {}

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Thống kê tổng quan hệ thống (Admin Only)' })
  async getStats(@Req() req: Request) {
    const data = await this.statsService.getStats();
    return {
      success: true,
      code: 'ADMIN_STATS_SUCCESS',
      message: 'Lấy thống kê hệ thống thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data,
    };
  }
}
