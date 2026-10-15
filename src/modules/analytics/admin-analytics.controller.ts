import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminAnalyticsService } from './admin-analytics.service';
import { QueryAnalyticsReportDto } from './dto/query-analytics-report.dto';

@ApiTags('Admin Analytics')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly adminAnalyticsService: AdminAnalyticsService) {}

  @Get('report')
  @ApiOperation({
    summary: 'Báo cáo truy cập và hành vi từ Google Analytics 4 (Admin Only)',
    description: 'Trả `{ configured: false }` khi server chưa cấu hình GA4. Kết quả được cache 15 phút.',
  })
  async getReport(@Req() req: Request, @Query() query: QueryAnalyticsReportDto) {
    const data = await this.adminAnalyticsService.getReport(query.range);
    return buildApiResponse(req, 'ADMIN_ANALYTICS_REPORT_SUCCESS', 'Lấy báo cáo GA4 thành công', data);
  }

  @Get('realtime')
  @ApiOperation({ summary: 'Số người dùng đang hoạt động trong 30 phút gần nhất (Admin Only)' })
  async getRealtime(@Req() req: Request) {
    const data = await this.adminAnalyticsService.getRealtime();
    return buildApiResponse(req, 'ADMIN_ANALYTICS_REALTIME_SUCCESS', 'Lấy dữ liệu GA4 realtime thành công', data);
  }
}
