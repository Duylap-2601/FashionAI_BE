import { ConfigService } from '@nestjs/config';
import { AdminAnalyticsService } from '../../src/modules/analytics/admin-analytics.service';
import { createRedisMock } from '../e2e/helpers/test-app';

function report(rows: { dims: string[]; metrics: number[] }[]) {
  return {
    rows: rows.map((row) => ({
      dimensionValues: row.dims.map((value) => ({ value })),
      metricValues: row.metrics.map((value) => ({ value: String(value) })),
    })),
  };
}

function gaDate(daysAgo: number) {
  // Khớp cách service dựng trục ngày theo giờ Việt Nam.
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000));
  return { iso, ga: iso.replace(/-/g, '') };
}

function createClient() {
  const today = gaDate(0);
  return {
    batchRunReports: jest
      .fn()
      .mockResolvedValueOnce([
        {
          reports: [
            report([{ dims: ['current'], metrics: [10, 5, 12, 0.5, 60, 40, 1] }]),
            report([{ dims: [today.ga], metrics: [9, 11] }]),
            report([
              { dims: ['purchase'], metrics: [1, 1] },
              { dims: ['view_item'], metrics: [8, 20] },
            ]),
            report([]),
            report([]),
          ],
        },
      ])
      .mockResolvedValueOnce([
        {
          reports: [
            report([{ dims: ['Suit Navy'], metrics: [20, 3, 1] }]),
            report([{ dims: ['mobile'], metrics: [7] }]),
            report([{ dims: ['Ho Chi Minh City'], metrics: [6] }]),
            report([{ dims: ['try_on_generate'], metrics: [15, 4] }]),
          ],
        },
      ]),
    runRealtimeReport: jest.fn(),
  };
}

function createService(client: ReturnType<typeof createClient> | null, redis = createRedisMock()) {
  const config = { get: (key: string) => ({ GA4_PROPERTY_ID: 'properties/42' })[key] } as unknown as ConfigService;
  return { service: new AdminAnalyticsService(config, redis as any, client), redis };
}

describe('AdminAnalyticsService', () => {
  it('trả configured=false khi thiếu client', async () => {
    const { service } = createService(null);

    await expect(service.getReport('7d')).resolves.toEqual({ configured: false });
    await expect(service.getRealtime()).resolves.toEqual({ configured: false });
  });

  it('điền đủ ngày cho biểu đồ và giữ đúng thứ tự phễu', async () => {
    const client = createClient();
    const { service } = createService(client);

    const result = await service.getReport('7d');
    if (!result.configured) throw new Error('expected configured report');

    expect(result.trend).toHaveLength(7);
    expect(result.trend[6]).toEqual({ date: gaDate(0).iso, activeUsers: 9, sessions: 11 });
    expect(result.trend[0]).toEqual({ date: gaDate(6).iso, activeUsers: 0, sessions: 0 });

    expect(result.funnel.map((step) => step.event)).toEqual([
      'view_item',
      'add_to_cart',
      'begin_checkout',
      'purchase',
    ]);
    expect(result.funnel[0]).toEqual({ event: 'view_item', users: 8, events: 20 });
    expect(result.funnel[1]).toEqual({ event: 'add_to_cart', users: 0, events: 0 });

    // Kỳ trước không có row nào thì về 0 thay vì undefined.
    expect(result.kpis.previous.activeUsers).toBe(0);
    expect(result.topProducts).toEqual([{ name: 'Suit Navy', views: 20, addedToCart: 3, purchased: 1 }]);
    expect(result.features.find((f) => f.event === 'try_on_generate')).toEqual({
      event: 'try_on_generate',
      count: 15,
      users: 4,
    });

    const [trafficCall] = client.batchRunReports.mock.calls[0];
    expect(trafficCall.property).toBe('properties/42');
    expect(trafficCall.requests[0].dateRanges).toEqual([
      { name: 'current', startDate: '6daysAgo', endDate: 'today' },
      { name: 'previous', startDate: '13daysAgo', endDate: '7daysAgo' },
    ]);
  });

  it('dùng cache cho lần gọi sau và gộp các request đồng thời', async () => {
    const client = createClient();
    const { service, redis } = createService(client);

    await Promise.all([service.getReport('28d'), service.getReport('28d')]);
    await service.getReport('28d');

    expect(client.batchRunReports).toHaveBeenCalledTimes(2);
    expect(redis.set).toHaveBeenCalledWith('ga4:report:properties/42:28d', expect.any(String), 900);
  });

  it('chỉ cache ngắn báo cáo chưa có lượt truy cập để số liệu mới hiện ngay khi GA4 xử lý xong', async () => {
    const client = createClient();
    client.batchRunReports.mockReset();
    client.batchRunReports
      .mockResolvedValueOnce([{ reports: [report([]), report([]), report([]), report([]), report([])] }])
      .mockResolvedValueOnce([{ reports: [report([]), report([]), report([]), report([])] }]);
    const { service, redis } = createService(client);

    const result = await service.getReport('7d');
    if (!result.configured) throw new Error('expected configured report');

    expect(result.kpis.current.activeUsers).toBe(0);
    expect(result.trend.every((point) => point.activeUsers === 0 && point.sessions === 0)).toBe(true);
    expect(redis.set).toHaveBeenCalledWith('ga4:report:properties/42:7d', expect.any(String), 60);
  });
});
