import {
  Controller,
  Post,
  Get,
  Delete,
  HttpCode,
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
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { buildApiResponse } from '../../common/utils/api-response.util';

@ApiTags('Chatbot')
@Controller('chat')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(QuotaGuard)
  @AiAction('CHATBOT')
  @ApiOperation({
    summary: 'Stream chat với FashionAI Assistant (SSE)',
    description: 'Trả về Server-Sent Events stream. Mỗi event: { type: "token" | "done" | "error", data: string }',
  })
  async chat(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChatRequestDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const generator = this.chatService.streamChat(user.id, dto);

    for await (const chunk of generator) {
      res.write(chunk);
    }

    res.end();
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