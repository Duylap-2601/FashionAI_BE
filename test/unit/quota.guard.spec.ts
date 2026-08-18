import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QuotaGuard } from '../../src/common/guards/quota.guard';
import { RedisService } from '../../src/common/services/redis.service';
import { PrismaService } from '../../src/database/prisma.service';

describe('QuotaGuard', () => {
  let guard: QuotaGuard;
  let reflector: Reflector;
  let redisService: RedisService;
  let prismaService: PrismaService;

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(),
  };

  const mockPrismaService = {
    dailyUsage: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(() => {
    reflector = mockReflector as any;
    redisService = mockRedisService as any;
    prismaService = mockPrismaService as any;
    guard = new QuotaGuard(reflector, redisService, prismaService);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should throw Unauthorized when no user is attached to request', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('TRY_ON');
    const mockContext = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({
        getRequest: () => ({ user: null }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(mockContext)).rejects.toThrow(HttpException);
  });

  it('should allow VIP user without quota limits', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('TRY_ON');
    const mockContext = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'vip-1', tier: 'VIP' } }),
      }),
    } as ExecutionContext;

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
  });

  it('should block FREE user when daily limit of 3 is reached', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('TRY_ON');
    mockRedisService.get.mockResolvedValue('3');

    const mockContext = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'free-1', tier: 'FREE' } }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(mockContext)).rejects.toThrow(HttpException);
  });

  it('should allow FREE user to use STYLIST action within its limit of 3', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('STYLIST');
    mockRedisService.get.mockResolvedValue('2');

    const mockContext = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'free-2', tier: 'FREE' } }),
      }),
    } as ExecutionContext;

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
  });

  it('should block FREE user when STYLIST daily limit of 3 is reached', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('STYLIST');
    mockRedisService.get.mockResolvedValue('3');

    const mockContext = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'free-3', tier: 'FREE' } }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(mockContext)).rejects.toThrow(HttpException);
  });

  it('should allow FREE user to use CHATBOT action within its limit of 50', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('CHATBOT');
    mockRedisService.get.mockResolvedValue('10');

    const mockContext = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'free-4', tier: 'FREE' } }),
      }),
    } as ExecutionContext;

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
  });

  it('should not consume quota itself when allowing the request', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('STYLIST');
    mockRedisService.get.mockResolvedValue('1');

    const request = { user: { id: 'free-5', tier: 'FREE' } };
    const mockContext = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;

    const result = await guard.canActivate(mockContext);

    // Guard chỉ kiểm tra hạn mức; việc tăng counter do service làm sau khi
    // provider trả kết quả, nên cache hit / lỗi provider không bị tính lượt.
    expect(result).toBe(true);
    expect(mockRedisService.incr).not.toHaveBeenCalled();
  });
});
