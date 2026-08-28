import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { RedisService } from '../../../common/services/redis.service';

const AUTH_CODE_TTL = 300; // 5 minutes
const AUTH_CODE_PREFIX = 'auth_code:';

interface AuthCodePayload {
  user: Record<string, unknown>;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

@Injectable()
export class AuthCodeService {
  private readonly logger = new Logger(AuthCodeService.name);

  constructor(private readonly redis: RedisService) {}

  async createCode(payload: AuthCodePayload): Promise<string> {
    const health = await this.redis.health();
    if (health.mode !== 'redis') {
      this.logger.warn(
        'AuthCodeService đang chạy trên in-memory fallback. OAuth mobile sẽ không đáng tin nếu deploy nhiều instance.',
      );
    }

    const code = randomBytes(32).toString('hex');
    await this.redis.set(
      `${AUTH_CODE_PREFIX}${code}`,
      JSON.stringify(payload),
      AUTH_CODE_TTL,
    );
    return code;
  }

  async consumeCode(code: string): Promise<AuthCodePayload | null> {
    const key = `${AUTH_CODE_PREFIX}${code}`;
    const data = await this.redis.get(key);
    if (!data) return null;
    await this.redis.del(key); // one-time use
    return JSON.parse(data) as AuthCodePayload;
  }
}
