import { HttpException } from '@nestjs/common';
import { QuotaService } from '../../src/common/services/quota.service';

describe('QuotaService.assertQuota', () => {
  let service: QuotaService;

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    setIfAbsent: jest.fn(),
    incr: jest.fn(),
    incrBy: jest.fn(),
    decrBy: jest.fn(),
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

  it('TC-132: MEMBER 20 lượt, VIP không giới hạn và bỏ qua counter', async () => {
    mockRedis.get.mockResolvedValue('19');
    await expect(service.assertQuota('member-1', 'MEMBER', 'STYLIST')).resolves.toBeUndefined();

    mockRedis.get.mockResolvedValue('20');
    await expect(service.assertQuota('member-2', 'MEMBER', 'STYLIST')).rejects.toMatchObject({
      status: 429,
      response: { code: 'QUOTA_EXCEEDED', details: { limit: 20, remaining: 0 } },
    });

    mockRedis.get.mockClear();
    await expect(service.assertQuota('vip-2', 'VIP', 'STYLIST')).resolves.toBeUndefined();
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('combo cần 2 lượt khi vừa đủ (còn 2) → cho phép', async () => {
    mockRedis.get.mockResolvedValue('3');
    await expect(
      service.assertQuota('member-combo-ok', 'MEMBER', 'TRY_ON', null, 2),
    ).resolves.toBeUndefined();
  });
});

describe('QuotaService.reserveQuota (atomic)', () => {
  let service: QuotaService;

  const mockRedis = {
    get: jest.fn(),
    set: jest.fn(),
    setIfAbsent: jest.fn(),
    incrBy: jest.fn(),
    decrBy: jest.fn(),
  };

  const mockPrisma = {
    dailyUsage: {
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QuotaService(mockRedis as any, mockPrisma as any);
    mockRedis.get.mockResolvedValue('2');
    mockRedis.setIfAbsent.mockResolvedValue(true);
    mockRedis.incrBy.mockResolvedValue(3);
    mockRedis.decrBy.mockResolvedValue(2);
  });

  it('giữ chỗ bằng một phép tăng nguyên tử trước khi gọi provider', async () => {
    await service.reserveQuota('free-1', 'FREE', 'STYLIST');

    expect(mockRedis.incrBy).toHaveBeenCalledWith(
      expect.stringContaining('quota:stylist:free-1:'),
      1,
      expect.any(Number),
    );
    expect(mockPrisma.dailyUsage.upsert).toHaveBeenCalled();
  });

  it('request thứ hai vượt limit bị 429 và hoàn lại lượt vừa tăng', async () => {
    mockRedis.incrBy.mockResolvedValue(4); // 3 còn 1, request này đẩy lên 4 > 3

    await expect(
      service.reserveQuota('free-2', 'FREE', 'STYLIST'),
    ).rejects.toMatchObject({
      status: 429,
      response: {
        code: 'QUOTA_EXCEEDED',
        details: { used: 3, limit: 3, requested: 1, remaining: 0 },
      },
    });

    expect(mockRedis.decrBy).toHaveBeenCalledWith(
      expect.stringContaining('quota:stylist:free-2:'),
      1,
    );
    expect(mockPrisma.dailyUsage.upsert).not.toHaveBeenCalled();
  });

  it('seed counter từ DB bằng SET NX khi cache trống', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.dailyUsage.findUnique.mockResolvedValue({ count: 2 });
    mockRedis.setIfAbsent.mockResolvedValue(true);
    mockRedis.incrBy.mockResolvedValue(3);

    await service.reserveQuota('free-3', 'FREE', 'STYLIST');

    expect(mockPrisma.dailyUsage.findUnique).toHaveBeenCalled();
    expect(mockRedis.setIfAbsent).toHaveBeenCalledWith(
      expect.stringContaining('quota:stylist:free-3:'),
      '2',
      expect.any(Number),
    );
  });

  it('không tăng counter khi VIP không giới hạn', async () => {
    await service.reserveQuota('vip-1', 'VIP', 'CHATBOT');
    expect(mockRedis.incrBy).not.toHaveBeenCalled();
  });

  it('releaseQuota hoàn lượt trong cache và DB', async () => {
    await service.releaseQuota('free-4', 'STYLIST');

    expect(mockRedis.decrBy).toHaveBeenCalledWith(
      expect.stringContaining('quota:stylist:free-4:'),
      1,
    );
    expect(mockPrisma.dailyUsage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { count: { decrement: 1 } } }),
    );
  });
});
