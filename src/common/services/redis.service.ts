import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { normalizeRedisUrl } from '../redis/redis-url.util';

const MAX_CONNECT_RETRIES = 3;
// Redis có thể lên sau app (docker compose, Redis restart): vẫn thử lại thưa để tự
// thoát chế độ in-memory thay vì kẹt tới khi restart app.
const SLOW_RECONNECT_MS = 30_000;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;
  private hasWarnedUnavailable = false;
  private inMemoryStore = new Map<string, { value: string; expiresAt?: number }>();

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const redisUrl = normalizeRedisUrl(this.configService.get<string>('REDIS_URL'));
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');

    try {
      const redisOptions = {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        // Khi không có Redis, service đã có fallback in-memory. Thử nhanh vài lần rồi
        // giãn ra SLOW_RECONNECT_MS; log chỉ in khi đổi trạng thái để không chôn log thật.
        retryStrategy: (times: number) =>
          times > MAX_CONNECT_RETRIES ? SLOW_RECONNECT_MS : Math.min(times * 200, 2000),
      } as const;

      this.client = redisUrl
        ? new Redis(redisUrl, redisOptions)
        : new Redis({
            host,
            port,
            password: password || undefined,
            ...redisOptions,
          });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.hasWarnedUnavailable = false;
        this.logger.log(
          redisUrl ? 'Connected to Redis via REDIS_URL' : `Connected to Redis at ${host}:${port}`,
        );
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });

      this.client.on('error', (err: any) => {
        this.isConnected = false;
        this.warnUnavailable(`Redis connection error: ${err.message}`);
      });

      this.client.connect().catch((err: any) => {
        this.isConnected = false;
        this.warnUnavailable(`Redis unavailable: ${err.message}`);
      });
    } catch (err: any) {
      this.logger.warn(`Failed to initialize Redis client: ${err.message}`);
    }
  }

  private warnUnavailable(reason: string) {
    if (this.hasWarnedUnavailable) return;
    this.hasWarnedUnavailable = true;
    this.logger.warn(
      `${reason}. Using fallback in-memory store, retrying every ${SLOW_RECONNECT_MS / 1000}s.`,
    );
  }

  async get(key: string): Promise<string | null> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.get(key);
      } catch (e) {
        this.logger.warn(`Redis operation failed | operation=get | namespace=${this.getKeyNamespace(key)}`);
      }
    }

    const item = this.inMemoryStore.get(key);
    if (!item) return null;
    if (item.expiresAt && item.expiresAt < Date.now()) {
      this.inMemoryStore.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        if (ttlSeconds) {
          await this.client.set(key, value, 'EX', ttlSeconds);
        } else {
          await this.client.set(key, value);
        }
        return;
      } catch (e) {
        this.logger.warn(`Redis operation failed | operation=set | namespace=${this.getKeyNamespace(key)}`);
      }
    }

    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.inMemoryStore.set(key, { value, expiresAt });
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    return this.incrBy(key, 1, ttlSeconds);
  }

  async incrBy(key: string, amount: number, ttlSeconds?: number): Promise<number> {
    if (this.isConnected && this.client) {
      try {
        const val = await this.client.incrby(key, amount);
        if (val === amount && ttlSeconds) {
          await this.client.expire(key, ttlSeconds);
        }
        return val;
      } catch (e) {
        this.logger.warn(`Redis operation failed | operation=incrby | namespace=${this.getKeyNamespace(key)}`);
      }
    }

    return this.incrementMemory(key, amount, ttlSeconds);
  }

  /**
   * Giảm counter (hoàn lượt đã giữ chỗ). Nếu khóa đã hết hạn thì `DECRBY` sẽ tạo
   * khóa âm, nên kẹp về 0 thay vì để counter âm.
   */
  async decrBy(key: string, amount: number, ttlSeconds?: number): Promise<number> {
    if (this.isConnected && this.client) {
      try {
        const val = await this.client.decrby(key, amount);
        if (val < 0) {
          if (ttlSeconds) {
            await this.client.set(key, '0', 'EX', ttlSeconds);
          } else {
            await this.client.set(key, '0');
          }
          return 0;
        }
        if (ttlSeconds) {
          await this.client.expire(key, ttlSeconds);
        }
        return val;
      } catch (e) {
        this.logger.warn(`Redis operation failed | operation=decrby | namespace=${this.getKeyNamespace(key)}`);
      }
    }

    return this.incrementMemory(key, -amount, ttlSeconds);
  }

  /**
   * Gán giá trị chỉ khi khóa chưa tồn tại (SET NX). Dùng để seed counter quota
   * từ DB mà không ghi đè giá trị một request khác vừa tạo.
   */
  async setIfAbsent(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    if (this.isConnected && this.client) {
      try {
        const result = ttlSeconds
          ? await this.client.set(key, value, 'EX', ttlSeconds, 'NX')
          : await this.client.set(key, value, 'NX');
        return result === 'OK';
      } catch (e) {
        this.logger.warn(`Redis operation failed | operation=setnx | namespace=${this.getKeyNamespace(key)}`);
      }
    }

    const now = Date.now();
    const item = this.inMemoryStore.get(key);
    if (item && (!item.expiresAt || item.expiresAt > now)) return false;
    this.inMemoryStore.set(key, {
      value,
      expiresAt: ttlSeconds ? now + ttlSeconds * 1000 : undefined,
    });
    return true;
  }

  /**
   * Tăng counter trong bộ nhớ một cách đồng bộ. Không có `await` giữa bước đọc
   * và ghi nên hai request đồng thời không thể cùng đọc một giá trị cũ.
   */
  private incrementMemory(key: string, amount: number, ttlSeconds?: number): number {
    const now = Date.now();
    const item = this.inMemoryStore.get(key);
    const isLive = item && (!item.expiresAt || item.expiresAt > now);
    const current = isLive ? parseInt(item!.value, 10) || 0 : 0;
    const next = Math.max(0, current + amount);
    const expiresAt = isLive && item!.expiresAt
      ? item!.expiresAt
      : ttlSeconds
        ? now + ttlSeconds * 1000
        : undefined;
    this.inMemoryStore.set(key, { value: String(next), expiresAt });
    return next;
  }

  async acquireLock(lockKey: string, ttlSeconds = 30): Promise<boolean> {
    if (this.isConnected && this.client) {
      try {
        const res = await this.client.set(lockKey, 'locked', 'EX', ttlSeconds, 'NX');
        return res === 'OK';
      } catch (e) {
        this.logger.warn(`Redis operation failed | operation=lock | namespace=${this.getKeyNamespace(lockKey)}`);
      }
    }

    const val = await this.get(lockKey);
    if (val) return false;
    await this.set(lockKey, 'locked', ttlSeconds);
    return true;
  }

  async releaseLock(lockKey: string): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        await this.client.del(lockKey);
        return;
      } catch (e) {
        this.logger.warn(`Redis operation failed | operation=release_lock | namespace=${this.getKeyNamespace(lockKey)}`);
      }
    }
    this.inMemoryStore.delete(lockKey);
  }

  async del(key: string): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        await this.client.del(key);
        return;
      } catch (e) {
        this.logger.warn(`Redis operation failed | operation=del | namespace=${this.getKeyNamespace(key)}`);
      }
    }
    this.inMemoryStore.delete(key);
  }

  async health() {
    if (this.isConnected && this.client) {
      try {
        const pong = await this.client.ping();
        return {
          status: pong === 'PONG' ? 'up' : 'down',
          mode: 'redis',
        };
      } catch (err: any) {
        this.logger.warn(`Redis health check failed: ${err.message}`);
      }
    }

    return {
      status: 'up',
      mode: 'fallback-memory',
    };
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.disconnect();
    }
  }

  private getKeyNamespace(key: string): string {
    return key.split(':', 1)[0] || 'unknown';
  }
}
