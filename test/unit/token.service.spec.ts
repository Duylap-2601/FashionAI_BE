import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { REFRESH_REUSE_GRACE_SECONDS, TokenService } from '../../src/modules/auth/token.service';

describe('TokenService refresh rotation', () => {
  const jwt = new JwtService();
  const config = {
    get: jest.fn((key: string) => ({ JWT_ACCESS_SECRET: 'access-secret', JWT_REFRESH_SECRET: 'refresh-secret' })[key]),
  } as unknown as ConfigService;

  let rows: Map<string, { userId: string; expiresAt: Date }>;
  let redis: Map<string, string>;
  let service: TokenService;

  beforeEach(() => {
    rows = new Map();
    redis = new Map();
    const prisma = {
      refreshToken: {
        create: jest.fn(async ({ data }: any) => rows.set(data.tokenHash, { userId: data.userId, expiresAt: data.expiresAt })),
        findUnique: jest.fn(async ({ where }: any) => rows.get(where.tokenHash) ?? null),
        deleteMany: jest.fn(async ({ where }: any) => {
          let count = 0;
          for (const [hash, row] of rows) {
            if (hash === where.tokenHash || row.userId === where.userId) {
              rows.delete(hash);
              count += 1;
            }
          }
          return { count };
        }),
      },
    };
    const redisService = {
      get: jest.fn(async (key: string) => redis.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => void redis.set(key, value)),
    };
    service = new TokenService(jwt, config, prisma as any, redisService as any);
  });

  it('cho dùng lại token vừa xoay khi response lần trước bị mất', async () => {
    const { token } = await service.generateRefreshToken('user-1');

    await expect(service.consumeRefreshToken(token)).resolves.toMatchObject({ sub: 'user-1' });
    await expect(service.consumeRefreshToken(token)).resolves.toMatchObject({ sub: 'user-1' });
    expect([...redis.values()]).toContain('user-1');
  });

  it('từ chối token đã xoá mà không có grace', async () => {
    const { token } = await service.generateRefreshToken('user-1');
    rows.clear();

    await expect(service.consumeRefreshToken(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('đăng xuất mọi nơi chặn luôn token đang trong grace', async () => {
    const { token } = await service.generateRefreshToken('user-1');
    await service.consumeRefreshToken(token);

    await service.revokeAllUserRefreshTokens('user-1');

    await expect(service.consumeRefreshToken(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('grace của user khác không mở được token', async () => {
    const { token } = await service.generateRefreshToken('user-1');
    await service.consumeRefreshToken(token);
    for (const key of redis.keys()) if (key.startsWith('refresh:grace:')) redis.set(key, 'user-2');

    await expect(service.consumeRefreshToken(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('grace sống đúng REFRESH_REUSE_GRACE_SECONDS', () => {
    expect(REFRESH_REUSE_GRACE_SECONDS).toBe(60);
  });
});
