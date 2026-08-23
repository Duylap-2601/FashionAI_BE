import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, UserTier } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { TOKEN_TYPES } from './constants';
import { GeneratedToken } from './interfaces/token.interface';
import { AccessTokenPayload, RefreshTokenPayload } from './types/jwt-payload.type';
import { requireConfig } from '../../common/utils/require-config.util';

@Injectable()
export class TokenService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {
    this.accessSecret = requireConfig(config, 'JWT_ACCESS_SECRET');
    this.refreshSecret = requireConfig(config, 'JWT_REFRESH_SECRET');
  }

  async generateAccessToken(user: {
    id: string;
    email: string;
    tier: UserTier;
    role: Role;
  }): Promise<GeneratedToken> {
    const jti = randomUUID();
    const expiresIn = this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
    const payload: Omit<AccessTokenPayload, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      tier: user.tier,
      role: user.role,
      jti,
      type: TOKEN_TYPES.access,
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.accessSecret,
      expiresIn: expiresIn as any,
    });

    return { token, jti, expiresAt: this.expiryFromNow(expiresIn) };
  }

  async generateRefreshToken(userId: string): Promise<GeneratedToken> {
    const jti = randomUUID();
    const expiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '30d';
    const payload: Omit<RefreshTokenPayload, 'iat' | 'exp'> = {
      sub: userId,
      jti,
      type: TOKEN_TYPES.refresh,
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.refreshSecret,
      expiresIn: expiresIn as any,
    });
    const expiresAt = this.expiryFromNow(expiresIn);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(token),
        expiresAt,
      },
    });

    return { token, jti, expiresAt };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.accessSecret,
      });
      if (payload.type !== TOKEN_TYPES.access || !payload.jti || !payload.sub) {
        throw new UnauthorizedException('Access token không hợp lệ');
      }
      if (await this.isAccessTokenBlacklisted(payload.jti)) {
        throw new UnauthorizedException('Access token đã bị thu hồi');
      }
      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Access token không hợp lệ hoặc đã hết hạn');
    }
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn');
    }

    if (payload.type !== TOKEN_TYPES.refresh || !payload.jti || !payload.sub) {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }

    const tokenHash = this.hashToken(token);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!stored || stored.userId !== payload.sub || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn');
    }

    return payload;
  }

  async consumeRefreshToken(token: string) {
    const payload = await this.verifyRefreshToken(token);
    await this.prisma.refreshToken.deleteMany({
      where: { tokenHash: this.hashToken(token) },
    });
    return payload;
  }

  async deleteRefreshToken(token: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { tokenHash: this.hashToken(token) },
    });
  }

  async revokeAllUserRefreshTokens(userId: string) {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });
    return result.count;
  }

  async blacklistAccessToken(jti: string, exp?: number) {
    const ttlSeconds = exp ? Math.max(exp - Math.floor(Date.now() / 1000), 1) : 15 * 60;
    await this.redisService.set(this.accessBlacklistKey(jti), '1', ttlSeconds);
  }

  async isAccessTokenBlacklisted(jti: string) {
    return (await this.redisService.get(this.accessBlacklistKey(jti))) !== null;
  }

  private accessBlacklistKey(jti: string) {
    return `blacklist:access:${jti}`;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private expiryFromNow(value: string) {
    const expires = new Date();
    const daysMatch = value.match(/^(\d+)d$/);
    const hoursMatch = value.match(/^(\d+)h$/);
    const minutesMatch = value.match(/^(\d+)m$/);
    const secondsMatch = value.match(/^(\d+)s$/);

    if (daysMatch) expires.setDate(expires.getDate() + Number(daysMatch[1]));
    else if (hoursMatch) expires.setHours(expires.getHours() + Number(hoursMatch[1]));
    else if (minutesMatch) expires.setMinutes(expires.getMinutes() + Number(minutesMatch[1]));
    else if (secondsMatch) expires.setSeconds(expires.getSeconds() + Number(secondsMatch[1]));
    else expires.setDate(expires.getDate() + 30);

    return expires;
  }
}
