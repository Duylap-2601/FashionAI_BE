import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { HttpException, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { RealtimeAuthService } from '../realtime/realtime-auth.service';
import { QuotaService } from '../../common/services/quota.service';
import { RedisService } from '../../common/services/redis.service';
import { parseCorsOrigins } from '../../common/utils/cors-origins.util';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';

const CHAT_LOCK_TTL_SECONDS = 120;

interface ChatSocketData {
  user: AuthenticatedUser;
}

/**
 * Chat realtime qua WebSocket. Dùng namespace riêng "/chat" — Socket.IO ghép
 * nhiều namespace lên CÙNG một kết nối WS nên client không tốn thêm socket,
 * mà chat vẫn tách biệt hoàn toàn khỏi RealtimeGateway (notification).
 *
 * Vì namespace riêng nên middleware auth của RealtimeGateway (đăng ký trên
 * namespace mặc định) không áp vào đây — gateway này tự đăng ký middleware,
 * tái dùng RealtimeAuthService làm nguồn sự thật xác thực.
 */
@WebSocketGateway({
  namespace: '/chat',
  transports: ['websocket'],
  cors: {
    origin: parseCorsOrigins(
      process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN,
      (process.env.CORS_CREDENTIALS ?? 'true').toLowerCase() === 'true',
      process.env.NODE_ENV === 'production',
      new Logger('ChatGateway'),
    ),
    credentials: (process.env.CORS_CREDENTIALS ?? 'true').toLowerCase() === 'true',
  },
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly realtimeAuth: RealtimeAuthService,
    private readonly quotaService: QuotaService,
    private readonly redisService: RedisService,
    private readonly chatService: ChatService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket: Socket, next) => {
      try {
        const raw = this.extractToken(socket);
        if (!raw) throw new Error('UNAUTHORIZED');
        const user = await this.realtimeAuth.authenticate(raw);
        (socket.data as ChatSocketData).user = user;
        next();
      } catch {
        next(new Error('UNAUTHORIZED'));
      }
    });
    this.logger.log('Chat gateway initialized (namespace /chat)');
  }

  handleConnection(socket: Socket): void {
    const user = (socket.data as ChatSocketData).user;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    this.logger.debug(`Chat connected: user=${user.id} socket=${socket.id}`);
  }

  @SubscribeMessage('chat:send')
  async handleSend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: ChatRequestDto,
  ): Promise<void> {
    const user = (socket.data as ChatSocketData).user;
    if (!user) {
      socket.emit('chat:error', { code: 'UNAUTHORIZED', message: 'Chưa xác thực.' });
      return;
    }

    // Token verify ở lúc connect; với socket sống lâu, chặn tiếp khi token hết hạn.
    if (user.exp && Date.now() >= user.exp * 1000) {
      socket.emit('chat:error', {
        code: 'TOKEN_EXPIRED',
        message: 'Phiên đăng nhập đã hết hạn, hãy kết nối lại với token mới.',
      });
      return;
    }

    // Hạn mức dùng chung với HTTP (QuotaService.assertQuota). Ném HttpException
    // -> chuyển thành event lỗi cho client.
    try {
      await this.quotaService.assertQuota(user.id, user.tier, 'CHATBOT', user.tierExpiresAt);
    } catch (err) {
      socket.emit('chat:error', this.toErrorPayload(err));
      return;
    }

    // WS không được RateLimitGuard che, lại không có 1 request/1 response như HTTP.
    // Lock theo user chặn spam gửi song song (mỗi lần vẫn trừ đúng 1 lượt quota).
    const lockKey = `ws:chat:lock:${user.id}`;
    const acquired = await this.redisService.acquireLock(lockKey, CHAT_LOCK_TTL_SECONDS);
    if (!acquired) {
      socket.emit('chat:error', {
        code: 'BUSY',
        message: 'Bạn đang có một yêu cầu chat đang xử lý. Vui lòng đợi.',
      });
      return;
    }

    try {
      // streamChat tự kiểm tra sessionId có thuộc user không (ownership check).
      for await (const event of this.chatService.streamChat(user.id, dto)) {
        if (event.type === 'token') {
          socket.emit('chat:token', { data: event.data });
        } else if (event.type === 'done') {
          socket.emit('chat:done', event.data);
        } else {
          socket.emit('chat:error', { code: 'STREAM_ERROR', message: event.data });
        }
      }
    } catch (err) {
      socket.emit('chat:error', this.toErrorPayload(err));
    } finally {
      await this.redisService.releaseLock(lockKey);
    }
  }

  private toErrorPayload(err: unknown): { code: string; message: string } {
    if (err instanceof HttpException) {
      const res = err.getResponse();
      if (res && typeof res === 'object') {
        const body = res as { code?: string; message?: string };
        return {
          code: body.code ?? 'ERROR',
          message: body.message ?? err.message,
        };
      }
      return { code: 'ERROR', message: err.message };
    }
    return { code: 'ERROR', message: 'Lỗi khi xử lý yêu cầu chat.' };
  }

  private extractToken(socket: Socket): string | undefined {
    const fromAuth = socket.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth;
    const header = socket.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return undefined;
  }
}
