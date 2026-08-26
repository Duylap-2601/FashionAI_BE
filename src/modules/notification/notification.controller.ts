import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationService } from './notification.service';
import { buildApiResponse } from '../../common/utils/api-response.util';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách thông báo (kèm số chưa đọc trong meta)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const result = await this.notificationService.list(
      user.id,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
    return buildApiResponse(
      req,
      'NOTIFICATIONS_SUCCESS',
      'Lấy danh sách thông báo thành công',
      result.items,
      result.meta,
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Số thông báo chưa đọc' })
  async unreadCount(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.notificationService.unreadCount(user.id);
    return buildApiResponse(req, 'NOTIFICATION_UNREAD_COUNT', 'Lấy số thông báo chưa đọc thành công', data);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Đánh dấu một thông báo đã đọc' })
  async markRead(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.notificationService.markRead(user.id, id);
    return buildApiResponse(req, 'NOTIFICATION_READ', 'Đã đánh dấu thông báo là đã đọc', data);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Đánh dấu tất cả thông báo đã đọc' })
  async markAllRead(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.notificationService.markAllRead(user.id);
    return buildApiResponse(req, 'NOTIFICATION_READ_ALL', 'Đã đánh dấu tất cả thông báo là đã đọc', data);
  }
}
