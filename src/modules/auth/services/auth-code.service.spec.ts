import { Test, TestingModule } from '@nestjs/testing';
import { AuthCodeService } from './auth-code.service';
import { RedisService } from '../../../common/services/redis.service';

describe('AuthCodeService', () => {
  let service: AuthCodeService;
  let redisService: RedisService;

  const mockRedisService = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    health: jest.fn().mockResolvedValue({ mode: 'redis' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthCodeService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<AuthCodeService>(AuthCodeService);
    redisService = module.get<RedisService>(RedisService);
    jest.clearAllMocks();
  });

  describe('createCode', () => {
    it('should create and store auth code', async () => {
      const payload = {
        user: { id: 'user-1', email: 'test@example.com' },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: '2026-08-28T15:00:00Z',
        refreshTokenExpiresAt: '2026-09-28T14:00:00Z',
      };

      mockRedisService.set.mockResolvedValue(undefined);

      const code = await service.createCode(payload);

      expect(code).toBeTruthy();
      expect(code).toHaveLength(64); // randomBytes(32).toString('hex') = 64 chars
      expect(mockRedisService.set).toHaveBeenCalledWith(
        expect.stringContaining('auth_code:'),
        JSON.stringify(payload),
        300,
      );
    });

    it('should log warning if Redis fallback is detected', async () => {
      const payload = {
        user: { id: 'user-1' },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: '2026-08-28T15:00:00Z',
        refreshTokenExpiresAt: '2026-09-28T14:00:00Z',
      };

      mockRedisService.health.mockResolvedValue({ mode: 'fallback-memory' });
      const warnSpy = jest.spyOn(service['logger'], 'warn');

      mockRedisService.set.mockResolvedValue(undefined);

      await service.createCode(payload);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('in-memory fallback'),
      );
    });
  });

  describe('consumeCode', () => {
    it('should retrieve and delete code (one-time use)', async () => {
      const payload = {
        user: { id: 'user-1', email: 'test@example.com' },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: '2026-08-28T15:00:00Z',
        refreshTokenExpiresAt: '2026-09-28T14:00:00Z',
      };

      const code = 'test-code-123';
      mockRedisService.get.mockResolvedValue(JSON.stringify(payload));
      mockRedisService.del.mockResolvedValue(undefined);

      const result = await service.consumeCode(code);

      expect(result).toEqual(payload);
      expect(mockRedisService.get).toHaveBeenCalledWith('auth_code:test-code-123');
      expect(mockRedisService.del).toHaveBeenCalledWith('auth_code:test-code-123');
    });

    it('should return null if code does not exist', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const result = await service.consumeCode('non-existent-code');

      expect(result).toBeNull();
      expect(mockRedisService.del).not.toHaveBeenCalled();
    });

    it('should return null on second consume attempt (one-time use)', async () => {
      const payload = {
        user: { id: 'user-1' },
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: '2026-08-28T15:00:00Z',
        refreshTokenExpiresAt: '2026-09-28T14:00:00Z',
      };

      const code = 'test-code-456';

      // First consume
      mockRedisService.get.mockResolvedValueOnce(JSON.stringify(payload));
      mockRedisService.del.mockResolvedValueOnce(undefined);

      const result1 = await service.consumeCode(code);
      expect(result1).toEqual(payload);

      // Second consume (should be gone)
      mockRedisService.get.mockResolvedValueOnce(null);

      const result2 = await service.consumeCode(code);
      expect(result2).toBeNull();
    });

    it('should handle malformed JSON gracefully', async () => {
      mockRedisService.get.mockResolvedValue('{invalid json}');

      await expect(service.consumeCode('code')).rejects.toThrow();
    });
  });
});
