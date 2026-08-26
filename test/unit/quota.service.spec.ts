import { HttpException } from '@nestjs/common';
import { QuotaService } from '../../src/common/services/quota.service';

describe('QuotaService.assertQuota', () => {
  let service: QuotaService;

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(),
  };

  const mockPrisma = {
    dailyUsage: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QuotaService(mockRedis as any, mockPrisma as any);
  });

  it('cho phép VIP không giới hạn (CHATBOT), không đọc counter', async () => {
    await expect(
      service.assertQuota('vip-1', 'VIP', 'CHATBOT'),
    ).resolves.toBeUndefined();
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('chặn FREE dùng TRY_ON bằng SUBSCRIPTION_REQUIRED (402), không đọc counter', async () => {
    await expect(
      service.assertQuota('free-tryon', 'FREE', 'TRY_ON'),
    ).rejects.toMatchObject({
      status: 402,
      response: { code: 'SUBSCRIPTION_REQUIRED' },
    });
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('hạ gói hết hạn về FREE → chặn TRY_ON (subscription_expired)', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await expect(
      service.assertQuota('expired-1', 'VIP', 'TRY_ON', yesterday),
    ).rejects.toMatchObject({
      status: 402,
      response: {
        code: 'SUBSCRIPTION_REQUIRED',
        details: { reason: 'subscription_expired' },
      },
    });
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('cho phép FREE khi còn lượt (đọc từ cache Redis)', async () => {
    mockRedis.get.mockResolvedValue('2');
    await expect(
      service.assertQuota('free-1', 'FREE', 'STYLIST'),
    ).resolves.toBeUndefined();
  });

  it('chặn FREE khi đã đạt limit', async () => {
    mockRedis.get.mockResolvedValue('3');
    await expect(
      service.assertQuota('free-2', 'FREE', 'STYLIST'),
    ).rejects.toThrow(HttpException);
  });

  it('tier undefined được coi như FREE', async () => {
    mockRedis.get.mockResolvedValue('50');
    await expect(
      service.assertQuota('free-3', undefined, 'CHATBOT'),
    ).rejects.toThrow(HttpException);
  });

  it('fallback về DB rồi seed lại cache khi cache miss', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.dailyUsage.findUnique.mockResolvedValue({ count: 1 });

    await service.assertQuota('member-4', 'MEMBER', 'TRY_ON');

    expect(mockPrisma.dailyUsage.findUnique).toHaveBeenCalled();
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('quota:try_on:member-4:'),
      '1',
      expect.any(Number),
    );
  });

  it('assertQuota không tự trừ lượt', async () => {
    mockRedis.get.mockResolvedValue('0');
    await service.assertQuota('free-5', 'FREE', 'CHATBOT');
    expect(mockRedis.incr).not.toHaveBeenCalled();
  });

  it('combo cần 2 lượt nhưng chỉ còn 1 → chặn QUOTA_EXCEEDED (MEMBER limit=5)', async () => {
    mockRedis.get.mockResolvedValue('4');
    await expect(
      service.assertQuota('member-combo', 'MEMBER', 'TRY_ON', null, 2),
    ).rejects.toMatchObject({
      status: 429,
      response: { code: 'QUOTA_EXCEEDED', details: { requested: 2 } },
    });
  });

  it('combo cần 2 lượt khi vừa đủ (còn 2) → cho phép', async () => {
    mockRedis.get.mockResolvedValue('3');
    await expect(
      service.assertQuota('member-combo-ok', 'MEMBER', 'TRY_ON', null, 2),
    ).resolves.toBeUndefined();
  });
});
