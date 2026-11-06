import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrderChatService } from './order-chat.service';

@ApiTags('Order chat')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('order-chats')
export class MyOrderChatsController {
  constructor(private readonly orderChatService: OrderChatService) {}

  @Get('mine')
  @ApiOperation({ summary: 'Danh sách phiên chat theo đơn của khách và các đơn gần đây' })
  async getMine(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.orderChatService.listMyThreads(user.id);
    return buildApiResponse(req, 'MY_ORDER_CHATS_SUCCESS', 'Lấy danh sách hội thoại thành công', data);
  }
}
