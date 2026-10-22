import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AdminAnalyticsController } from '../../src/modules/analytics/admin-analytics.controller';
import { AdminAnalyticsService } from '../../src/modules/analytics/admin-analytics.service';
import { GA4_DATA_CLIENT } from '../../src/modules/analytics/constants/analytics.constants';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { createTestApp } from './helpers/test-app';

let currentUser: { id: string; email: string; role: 'USER' | 'ADMIN' };

const authGuardStub = {
  canActivate: (context: any) => {
    context.switchToHttp().getRequest().user = currentUser;
    return true;
  },
};

function report(rows: { dims: string[]; metrics: number[] }[]) {
  return {
    rows: rows.map((row) => ({
      dimensionValues: row.dims.map((value) => ({ value })),
      metricValues: row.metrics.map((value) => ({ value: String(value) })),
    })),
  };
}

describe('Admin analytics (e2e)', () => {
  let app: INestApplication;
  let client: { batchRunReports: jest.Mock; runRealtimeReport: jest.Mock } | null;
  let config: Record<string, string>;

  async function boot() {
    const created = await createTestApp({
      metadata: {
        controllers: [AdminAnalyticsController],
        providers: [
          AdminAnalyticsService,
          { provide: ConfigService, useValue: { get: (key: string) => config[key] } },
          { provide: GA4_DATA_CLIENT, useValue: client },
        ],
      },
      configure: (builder) => builder.overrideGuard(JwtAuthGuard).useValue(authGuardStub),
    });
    app = created.app;
  }

  beforeEach(() => {
    currentUser = { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' };
    config = { GA4_PROPERTY_ID: '123456789' };
    client = {
      batchRunReports: jest
        .fn()
        .mockResolvedValueOnce([
          {
            reports: [
              report([
                { dims: ['current'], metrics: [120, 80, 200, 0.6, 95, 900, 4] },
                { dims: ['previous'], metrics: [100, 70, 150, 0.5, 80, 700, 2] },
              ]),
              report([]),
              report([{ dims: ['view_item'], metrics: [60, 140] }]),
              report([{ dims: ['Organic Search'], metrics: [90, 70, 0.7] }]),
              report([{ dims: ['/products'], metrics: [300, 90] }]),
            ],
          },
        ])
        .mockResolvedValueOnce([
          {
            reports: [
              report([]),
              report([]),
              report([]),
              report([]),
              report([
                { dims: ['tiktok'], metrics: [12] },
                { dims: ['facebook'], metrics: [8] },
              ]),
            ],
          },
        ]),
      runRealtimeReport: jest.fn().mockResolvedValue([report([{ dims: [], metrics: [7] }])]),
    };
  });

  afterEach(async () => {
    await app?.close();
  });

  it('chặn user thường với 403', async () => {
    currentUser = { id: 'user-1', email: 'user@test.com', role: 'USER' };
    await boot();

    await request(app.getHttpServer()).get('/api/admin/analytics/report').expect(403);
    await request(app.getHttpServer()).get('/api/admin/analytics/realtime').expect(403);
    expect(client!.batchRunReports).not.toHaveBeenCalled();
  });

  it('trả configured=false khi server chưa cấu hình GA4', async () => {
    client = null;
    await boot();

    const res = await request(app.getHttpServer()).get('/api/admin/analytics/report').expect(200);

    expect(res.body.code).toBe('ADMIN_ANALYTICS_REPORT_SUCCESS');
    expect(res.body.data).toEqual({ configured: false });
  });

  it('trả báo cáo 28 ngày mặc định cho admin', async () => {
    await boot();

    const res = await request(app.getHttpServer()).get('/api/admin/analytics/report').expect(200);

    expect(res.body.data).toMatchObject({
      configured: true,
      range: '28d',
      kpis: {
        current: { activeUsers: 120, sessions: 200, purchases: 4 },
        previous: { activeUsers: 100, sessions: 150, purchases: 2 },
      },
      channels: [{ channel: 'Organic Search', sessions: 90, activeUsers: 70, engagementRate: 0.7 }],
      topPages: [{ path: '/products', views: 300, activeUsers: 90 }],
      platformSources: [
        { source: 'tiktok', users: 12 },
        { source: 'facebook', users: 8 },
      ],
    });
    expect(res.body.data.trend).toHaveLength(28);
    expect(client!.batchRunReports).toHaveBeenCalledWith(
      expect.objectContaining({ property: 'properties/123456789' }),
    );
  });

  it('từ chối range không hỗ trợ', async () => {
    await boot();

    const res = await request(app.getHttpServer()).get('/api/admin/analytics/report?range=365d').expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(client!.batchRunReports).not.toHaveBeenCalled();
  });

  it('trả 502 với thông báo rõ khi service account thiếu quyền', async () => {
    client!.batchRunReports.mockReset().mockRejectedValue(Object.assign(new Error('denied'), { code: 7 }));
    await boot();

    const res = await request(app.getHttpServer()).get('/api/admin/analytics/report?range=7d').expect(502);

    expect(res.body.code).toBe('ANALYTICS_UPSTREAM_ERROR');
    expect(res.body.message).toContain('Viewer');
  });

  it('trả số người dùng realtime', async () => {
    await boot();

    const res = await request(app.getHttpServer()).get('/api/admin/analytics/realtime').expect(200);

    expect(res.body.data).toMatchObject({ configured: true, activeUsers: 7 });
  });
});
