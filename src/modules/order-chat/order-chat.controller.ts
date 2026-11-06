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
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MarkOrderChatReadDto, SendOrderChatMessageDto } from './dto/order-chat.dto';
import { OrderChatService } from './order-chat.service';

@ApiTags('Order chat')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('orders/:orderId/chat')
export class OrderChatController {
  constructor(private readonly orderChatService: OrderChatService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy hội thoại của một đơn hàng (khách sở hữu hoặc admin)' })
  async getThread(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.orderChatService.getThread(
      user,
      orderId,
      before,
      limit ? Number(limit) : undefined,
    );
    return buildApiResponse(req, 'ORDER_CHAT_FETCH_SUCCESS', 'Lấy hội thoại thành công', data);
  }

  @Post('messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('application/json', 'multipart/form-data')
  @UseInterceptors(AnyFilesInterceptor({
    limits: { fileSize: 10 * 1024 * 1024, files: 3, fields: 5 },
  }))
  @ApiOperation({ summary: 'Gửi tin nhắn cho shop/khách trong đơn hàng' })
  async sendMessage(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: SendOrderChatMessageDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const data = await this.orderChatService.sendMessage(
      user,
      orderId,
      dto,
      (files ?? []).filter((file) => file.fieldname === 'images'),
    );
    return buildApiResponse(req, 'ORDER_CHAT_MESSAGE_SENT', 'Gửi tin nhắn thành công', data);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đánh dấu đã đọc tin nhắn của đơn hàng' })
  async markRead(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: MarkOrderChatReadDto,
  ) {
    const data = await this.orderChatService.markRead(user, orderId, dto);
    return buildApiResponse(req, 'ORDER_CHAT_READ', 'Đã đánh dấu đã đọc', data);
  }
}
