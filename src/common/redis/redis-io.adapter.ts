import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions } from 'socket.io';

/**
 * WebSocket adapter gắn @socket.io/redis-adapter để event fan-out qua mọi
 * instance (Render scale >1). Nếu không có REDIS_URL thì chạy adapter mặc định
 * (in-memory) — đúng cho dev 1 instance.
 *
 * Tạo cặp client pub/sub RIÊNG, không tái dùng RedisService: RedisService dùng
 * enableOfflineQueue=false + maxRetriesPerRequest=1 + fallback in-memory, còn
 * subscriber của adapter bị khoá ở subscriber mode và cần reconnect vô hạn — hai
 * chế độ xung đột, và fallback in-memory sẽ âm thầm làm mất event khi scale.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(url: string): Promise<void> {
    const pub = new Redis(url, { maxRetriesPerRequest: null });
    const sub = pub.duplicate();

    pub.on('error', (err) =>
      this.logger.error(`Redis adapter pub error: ${err.message}`),
    );
    sub.on('error', (err) =>
      this.logger.error(`Redis adapter sub error: ${err.message}`),
    );

    await Promise.all([
      pub.status === 'ready' ? Promise.resolve() : pub.connect().catch(() => undefined),
      sub.status === 'ready' ? Promise.resolve() : sub.connect().catch(() => undefined),
    ]);

    this.pubClient = pub;
    this.subClient = sub;
    this.adapterConstructor = createAdapter(pub, sub);
    this.logger.log('Socket.IO Redis adapter connected');
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async disconnect(): Promise<void> {
    this.pubClient?.disconnect();
    this.subClient?.disconnect();
  }
}
