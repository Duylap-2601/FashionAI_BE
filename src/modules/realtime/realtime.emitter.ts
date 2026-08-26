import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

/**
 * Provider trung gian giữ Server để tránh circular dependency: các service
 * nghiệp vụ (Notification, Orders qua Notification...) chỉ phụ thuộc emitter này,
 * còn gateway đăng ký Server vào đây ở afterInit. Chiều phụ thuộc một hướng:
 * Gateway -> service -> RealtimeEmitter.
 *
 * Khi đã bật Redis adapter, server.to(room).emit() tự fan-out qua mọi instance —
 * không cần map userId<->socketId thủ công để gửi.
 */
@Injectable()
export class RealtimeEmitter {
  private readonly logger = new Logger(RealtimeEmitter.name);
  private server?: Server;

  register(server: Server): void {
    this.server = server;
  }

  toUser(userId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.warn(`Emit "${event}" trước khi gateway init, bỏ qua`);
      return;
    }
    this.server.to(this.userRoom(userId)).emit(event, payload);
  }

  userRoom(userId: string): string {
    return `user:${userId}`;
  }

  /**
   * Trạng thái WS cho health check. `clients` là tổng kết nối engine.io hiện tại
   * (gồm mọi namespace ghép trên cùng transport). `ready=false` nghĩa là gateway
   * chưa init xong (server chưa được đăng ký).
   */
  status(): { ready: boolean; clients: number } {
    return {
      ready: !!this.server,
      clients: this.server?.engine?.clientsCount ?? 0,
    };
  }
}
