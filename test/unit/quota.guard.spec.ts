import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QuotaGuard } from '../../src/common/guards/quota.guard';
import { QuotaService } from '../../src/common/services/quota.service';

describe('QuotaGuard', () => {
  let guard: QuotaGuard;

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const mockQuotaService = {
    assertQuota: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new QuotaGuard(mockReflector as any, mockQuotaService as any);
  });

  function contextWithUser(user: any): ExecutionContext {
    return {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as ExecutionContext;
  }

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('ném Unauthorized khi request không có user', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('TRY_ON');
    await expect(guard.canActivate(contextWithUser(null))).rejects.toThrow(
      HttpException,
    );
    expect(mockQuotaService.assertQuota).not.toHaveBeenCalled();
  });

  it('ủy quyền kiểm tra hạn mức cho QuotaService với action + tier đúng', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('CHATBOT');
    mockQuotaService.assertQuota.mockResolvedValue(undefined);

    const result = await guard.canActivate(
      contextWithUser({ id: 'u1', tier: 'MEMBER' }),
    );

    expect(result).toBe(true);
    expect(mockQuotaService.assertQuota).toHaveBeenCalledWith(
      'u1',
      'MEMBER',
      'CHATBOT',
      undefined,
    );
  });

  it('mặc định action = TRY_ON khi handler không gắn @AiAction', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    mockQuotaService.assertQuota.mockResolvedValue(undefined);

    await guard.canActivate(contextWithUser({ id: 'u2', tier: 'FREE' }));

    expect(mockQuotaService.assertQuota).toHaveBeenCalledWith(
      'u2',
      'FREE',
      'TRY_ON',
      undefined,
    );
  });

  it('cho lỗi hết hạn mức từ service nổi lên nguyên trạng', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('STYLIST');
    mockQuotaService.assertQuota.mockRejectedValue(
      new HttpException({ code: 'QUOTA_EXCEEDED' }, 429),
    );

    await expect(
      guard.canActivate(contextWithUser({ id: 'u3', tier: 'FREE' })),
    ).rejects.toThrow(HttpException);
  });
});
