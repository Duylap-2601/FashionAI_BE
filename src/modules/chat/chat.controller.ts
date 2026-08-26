import {
  Controller,
  Post,
  Get,
  Delete,
  HttpCode,
  HttpException,
  HttpStatus,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { QuotaGuard, AiAction } from '../../common/guards/quota.guard';
import { RedisService } from '../../common/services/redis.service';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { buildApiResponse } from '../../common/utils/api-response.util';

const SSE_USAGE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 ngày

@ApiTags('Chatbot')
@Controller('chat')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly redisService: RedisService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(QuotaGuard)
  @AiAction('CHATBOT')
  @ApiOperation({
    summary: 'Stream chat với FashionAI Assistant (SSE — legacy)',
    description:
      'Trả về Server-Sent Events stream. Mỗi event: { type: "token" | "done" | "error", data: ... }. ' +
      'ĐANG DẦN THAY BẰNG WebSocket (namespace /chat, event chat:send). Route này giữ tạm cho tương thích.',
  })
  async chat(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChatRequestDto,
    @Res() res: Response,
  ) {
    // Đếm lượt dùng SSE để biết khi nào FE đã chuyển hẳn sang WS -> xóa route này.
    // Non-blocking: lỗi Redis không được cản trở chat.
    const today = new Date().toISOString().split('T')[0];
    this.redisService
      .incr(`legacy:sse:chat:${today}`, SSE_USAGE_TTL_SECONDS)
      .catch(() => undefined);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      for await (const event of this.chatService.streamChat(user.id, dto)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err: unknown) {
      // Header SSE đã flush nên GlobalExceptionFilter không còn trả JSON được nữa
      // (ERR_HTTP_HEADERS_SENT, request treo vô hạn). Báo lỗi qua chính stream.
      // Chỉ chuyển tiếp message của HttpException để không lộ chi tiết nội bộ.
      const message =
        err instanceof HttpException ? err.message : 'Lỗi khi xử lý yêu cầu chat.';
      res.write(`data: ${JSON.stringify({ type: 'error', data: message })}\n\n`);
    } finally {
      res.end();
    }
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Danh sách phiên chat của người dùng' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getSessions(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const result = await this.chatService.getSessions(user.id, page ? Number(page) : 1, limit ? Number(limit) : 20);
    return buildApiResponse(req, 'CHAT_SESSIONS_SUCCESS', 'Lấy danh sách phiên chat thành công', result.items, result.meta);
  }

  @Get('sessions/:sessionId')
  @ApiOperation({ summary: 'Chi tiết một phiên chat (kèm toàn bộ tin nhắn)' })
  async getSession(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
  ) {
    const session = await this.chatService.getSession(user.id, sessionId);
    return buildApiResponse(req, 'CHAT_SESSION_SUCCESS', 'Lấy chi tiết phiên chat thành công', session);
  }

  @Delete('sessions/:sessionId')
  @ApiOperation({ summary: 'Xóa một phiên chat' })
  async deleteSession(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
  ) {
    const data = await this.chatService.deleteSession(user.id, sessionId);
    return buildApiResponse(req, 'CHAT_SESSION_DELETED', 'Xóa phiên chat thành công', data);
  }
}