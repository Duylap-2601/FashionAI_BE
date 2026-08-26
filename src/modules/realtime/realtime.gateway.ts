import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeEmitter } from './realtime.emitter';
import { parseCorsOrigins } from '../../common/utils/cors-origins.util';

const REAUTH_WARNING_LEAD_MS = 60_000;

interface SocketData {
  user: AuthenticatedUser;
  expiryWarnTimer?: NodeJS.Timeout;
  expiryKickTimer?: NodeJS.Timeout;
}

@WebSocketGateway({
  // Render không đảm bảo sticky session -> polling (cần sticky cho handshake +
  // các poll sau về cùng instance) sẽ lỗi khi scale. Chỉ dùng websocket.
  transports: ['websocket'],
  cors: {
    origin: parseCorsOrigins(
      process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN,
      (process.env.CORS_CREDENTIALS ?? 'true').toLowerCase() === 'true',
      process.env.NODE_ENV === 'production',
      new Logger('RealtimeGateway'),
    ),
    credentials: (process.env.CORS_CREDENTIALS ?? 'true').toLowerCase() === 'true',
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly realtimeAuth: RealtimeAuthService,
    private readonly emitter: RealtimeEmitter,
  ) {}

  afterInit(server: Server): void {
    this.emitter.register(server);

    // Auth middleware chạy trước khi connection được chấp nhận. Token lấy từ
    // handshake.auth.token, fallback header Authorization: Bearer.
    server.use(async (socket: Socket, next) => {
      try {
        const raw = this.extractToken(socket);
        if (!raw) throw new Error('UNAUTHORIZED');
        const user = await this.realtimeAuth.authenticate(raw);
        (socket.data as SocketData).user = user;
        next();
      } catch {
        next(new Error('UNAUTHORIZED'));
      }
    });

    this.logger.log('Realtime gateway initialized');
  }

  handleConnection(socket: Socket): void {
    const data = socket.data as SocketData;
    const user = data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    void socket.join(this.emitter.userRoom(user.id));
    this.scheduleExpiry(socket, user.exp);
    this.logger.debug(`Connected: user=${user.id} socket=${socket.id}`);
  }

  handleDisconnect(socket: Socket): void {
    // Bắt buộc clear timer, không thì mỗi connection leak 2 timer.
    this.clearExpiry(socket);
  }

  @SubscribeMessage('auth:refresh')
  async handleReauth(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { token?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const current = (socket.data as SocketData).user;
    try {
      const raw = body?.token?.trim();
      if (!raw) return { ok: false, error: 'MISSING_TOKEN' };

      const next = await this.realtimeAuth.authenticate(raw);
      // Token mới phải cùng user — chống lấy socket của người này nhét token
      // người khác để nhận event của họ.
      if (current && next.id !== current.id) {
        socket.disconnect(true);
        return { ok: false, error: 'USER_MISMATCH' };
      }

      (socket.data as SocketData).user = next;
      this.scheduleExpiry(socket, next.exp);
      return { ok: true };
    } catch {
      return { ok: false, error: 'INVALID_TOKEN' };
    }
  }

  private scheduleExpiry(socket: Socket, exp: number): void {
    this.clearExpiry(socket);
    if (!exp) return;

    const data = socket.data as SocketData;
    const ttlMs = exp * 1000 - Date.now();
    if (ttlMs <= 0) {
      socket.disconnect(true);
      return;
    }

    const warnMs = ttlMs - REAUTH_WARNING_LEAD_MS;
    if (warnMs > 0) {
      data.expiryWarnTimer = setTimeout(() => {
        socket.emit('token:expiring', { expiresInMs: REAUTH_WARNING_LEAD_MS });
      }, warnMs);
    }

    data.expiryKickTimer = setTimeout(() => {
      socket.emit('token:expired', {});
      socket.disconnect(true);
    }, ttlMs);
  }

  private clearExpiry(socket: Socket): void {
    const data = socket.data as SocketData;
    if (data.expiryWarnTimer) clearTimeout(data.expiryWarnTimer);
    if (data.expiryKickTimer) clearTimeout(data.expiryKickTimer);
    data.expiryWarnTimer = undefined;
    data.expiryKickTimer = undefined;
  }

  private extractToken(socket: Socket): string | undefined {
    const fromAuth = socket.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth;
    const header = socket.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return undefined;
  }
}
