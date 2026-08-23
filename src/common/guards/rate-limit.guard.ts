import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { RedisService } from '../services/redis.service';

type RateLimitRule = {
  windowSeconds: number;
  max: number;
  scope: string;
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const rule = this.getRule(req);

    if (rule.max <= 0 || rule.windowSeconds <= 0) return true;

    const ip = this.getClientIp(req);
    const windowId = Math.floor(Date.now() / (rule.windowSeconds * 1000));
    const key = `rate:${rule.scope}:${ip}:${windowId}`;
    const used = await this.redisService.incr(key, rule.windowSeconds + 5);

    if (used > rule.max) {
      throw new HttpException(
        {
          success: false,
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          details: {
            scope: rule.scope,
            limit: rule.max,
            windowSeconds: rule.windowSeconds,
            retryAfterSeconds: this.secondsUntilNextWindow(rule.windowSeconds),
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private getRule(req: Request): RateLimitRule {
    const path = (req.originalUrl ?? req.url).split('?')[0].toLowerCase();
    const isAuthSensitive =
      path.endsWith('/auth/login') ||
      path.endsWith('/auth/register') ||
      path.endsWith('/auth/forgot-password') ||
      path.endsWith('/auth/reset-password') ||
      path.endsWith('/auth/resend-verification');

    if (isAuthSensitive) {
      return {
        scope: 'auth',
        windowSeconds: this.getNumber('AUTH_RATE_LIMIT_WINDOW_SECONDS', 60),
        max: this.getNumber('AUTH_RATE_LIMIT_MAX', 10),
      };
    }

    return {
      scope: 'global',
      windowSeconds: this.getNumber('GLOBAL_RATE_LIMIT_WINDOW_SECONDS', 60),
      max: this.getNumber('GLOBAL_RATE_LIMIT_MAX', 100),
    };
  }

  private getClientIp(req: Request) {
    // Không tự parse X-Forwarded-For: header đó client đặt được, nên phần tử đầu
    // tiên có thể là giá trị bịa — đổi mỗi request là vô hiệu hoá rate limit.
    // Express đã tính sẵn req.ip theo số hop tin cậy khai báo ở `trust proxy`
    // (xem main.ts), tức chỉ tin phần do proxy của mình thêm vào.
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  private secondsUntilNextWindow(windowSeconds: number) {
    const elapsed = Math.floor(Date.now() / 1000) % windowSeconds;
    return windowSeconds - elapsed;
  }

  private getNumber(key: string, fallback: number) {
    const raw = this.config.get<string>(key);
    const value = raw ? Number(raw) : fallback;
    return Number.isFinite(value) ? value : fallback;
  }
}
