import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { normalizeRedisUrl } from '../redis/redis-url.util';

const MAX_CONNECT_RETRIES = 3;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;
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
        // Khi không có Redis, service đã có fallback in-memory. Không chặn lại thì
        // ioredis reconnect vô hạn và log warning mỗi ~2s, chôn vùi log thật.
        retryStrategy: (times: number) =>
          times > MAX_CONNECT_RETRIES ? null : Math.min(times * 200, 2000),
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
        this.logger.log(
          redisUrl ? 'Connected to Redis via REDIS_URL' : `Connected to Redis at ${host}:${port}`,
        );
      });

      this.client.on('error', (err: any) => {
        this.isConnected = false;
        this.logger.warn(`Redis connection error: ${err.message}. Falling back to in-memory store.`);
      });

      this.client.connect().catch((err: any) => {
        this.isConnected = false;
        this.logger.warn(`Redis unavailable: ${err.message}. Using fallback in-memory store.`);
      });
    } catch (err: any) {
      this.logger.warn(`Failed to initialize Redis client: ${err.message}`);
    }
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
    if (this.isConnected && this.client) {
      try {
        const val = await this.client.incr(key);
        if (val === 1 && ttlSeconds) {
          await this.client.expire(key, ttlSeconds);
        }
        return val;
      } catch (e) {
        this.logger.warn(`Redis operation failed | operation=incr | namespace=${this.getKeyNamespace(key)}`);
      }
    }

    const currentStr = await this.get(key);
    const val = (currentStr ? parseInt(currentStr, 10) : 0) + 1;
    await this.set(key, val.toString(), ttlSeconds);
    return val;
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

    const currentStr = await this.get(key);
    const val = (currentStr ? parseInt(currentStr, 10) : 0) + amount;
    await this.set(key, val.toString(), ttlSeconds);
    return val;
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
