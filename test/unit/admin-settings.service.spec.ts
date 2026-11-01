import { ConfigService } from '@nestjs/config';
import { AdminSettingsService } from '../../src/modules/admin/admin-settings.service';
import { PrismaService } from '../../src/database/prisma.service';

function createService(configValues: Record<string, string> = {}, rows: unknown[] = []) {
  const prisma = { $queryRaw: jest.fn().mockResolvedValue(rows) };
  const config = { get: jest.fn((key: string) => configValues[key]) };
  const service = new AdminSettingsService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );
  return { service, prisma };
}

describe('AdminSettingsService live try-on policy', () => {
  it('converts a legacy policy that still stores globalDailyCredits', async () => {
    const { service } = createService({ DECART_LIVE_RATE_CREDITS_PER_SECOND: '2' }, [{
      value: {
        enabled: true,
        version: 2,
        globalDailyCredits: 12000,
        maxConcurrentSessions: 5,
        pauseTimeoutSeconds: 300,
        allowedCategories: ['UPPER'],
        betaUserIds: ['user-1'],
        betaProductIds: ['product-1'],
        tiers: {
          FREE: { liveEnabled: true, dailySeconds: 150, maxSessionSeconds: 15 },
          MEMBER: { liveEnabled: true, dailySeconds: 300, maxSessionSeconds: 30 },
          VIP: { liveEnabled: true, dailySeconds: 300, maxSessionSeconds: 60 },
        },
      },
    }]);

    const settings = await service.getLiveTryOnSettings();

    expect(settings.source).toBe('database');
    expect(settings.globalDailySeconds).toBe(6000);
    expect(settings.tiers.MEMBER.dailySeconds).toBe(300);
    expect(settings).not.toHaveProperty('betaUserIds');
    expect(settings).not.toHaveProperty('betaProductIds');
  });
});
