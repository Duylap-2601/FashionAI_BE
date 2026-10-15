import { BadGatewayException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../common/services/redis.service';
import {
  ANALYTICS_RANGE_DAYS,
  ANALYTICS_TIMEZONE,
  AnalyticsRange,
  FEATURE_EVENTS,
  FUNNEL_EVENTS,
  GA4_DATA_CLIENT,
  REALTIME_CACHE_TTL_SECONDS,
  REPORT_CACHE_TTL_SECONDS,
} from './constants/analytics.constants';
import {
  AnalyticsKpis,
  AnalyticsNotConfigured,
  AnalyticsRealtime,
  AnalyticsReport,
  Ga4DataClient,
  Ga4ReportRequest,
  Ga4ReportResponse,
} from './types/admin-analytics.types';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_LIMIT = 10;
const GRPC_PERMISSION_DENIED = 7;
const GRPC_RESOURCE_EXHAUSTED = 8;

// Thứ tự metric ở đây quyết định index khi đọc row trong toKpis().
const KPI_METRICS = [
  'activeUsers',
  'newUsers',
  'sessions',
  'engagementRate',
  'averageSessionDuration',
  'screenPageViews',
  'ecommercePurchases',
] as const;

type Ga4Row = NonNullable<Ga4ReportResponse['rows']>[number];

function rowsOf(report?: Ga4ReportResponse | null): Ga4Row[] {
  return report?.rows ?? [];
}

function dimensionOf(row: Ga4Row | undefined, index = 0): string {
  return row?.dimensionValues?.[index]?.value ?? '';
}

function metricOf(row: Ga4Row | undefined, index: number): number {
  const value = Number(row?.metricValues?.[index]?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function inListFilter(fieldName: string, values: readonly string[]): Ga4ReportRequest['dimensionFilter'] {
  return { filter: { fieldName, inListFilter: { values: [...values] } } };
}

function orderByMetricDesc(metricName: string): Ga4ReportRequest['orderBys'] {
  return [{ metric: { metricName }, desc: true }];
}

/** `days` ngày gần nhất tính tới hôm nay, dạng YYYY-MM-DD theo giờ Việt Nam. */
function lastDays(days: number, now = new Date()): string[] {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: ANALYTICS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return Array.from({ length: days }, (_, i) => format.format(new Date(now.getTime() - (days - 1 - i) * DAY_MS)));
}

/** GA4 trả dimension `date` dạng YYYYMMDD. */
function toIsoDate(gaDate: string): string {
  return `${gaDate.slice(0, 4)}-${gaDate.slice(4, 6)}-${gaDate.slice(6, 8)}`;
}

@Injectable()
export class AdminAnalyticsService {
  private readonly logger = new Logger(AdminAnalyticsService.name);
  private readonly property?: string;
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    configService: ConfigService,
    private readonly redisService: RedisService,
    @Inject(GA4_DATA_CLIENT) private readonly client: Ga4DataClient | null,
  ) {
    const propertyId = configService.get<string>('GA4_PROPERTY_ID')?.trim().replace(/^properties\//, '');
    this.property = propertyId ? `properties/${propertyId}` : undefined;
  }

  async getReport(range: AnalyticsRange = '28d'): Promise<AnalyticsReport | AnalyticsNotConfigured> {
    const { client, property } = this;
    if (!client || !property) return { configured: false };

    return this.cached(`ga4:report:${property}:${range}`, REPORT_CACHE_TTL_SECONDS, () =>
      this.fetchReport(client, property, range),
    );
  }

  async getRealtime(): Promise<AnalyticsRealtime | AnalyticsNotConfigured> {
    const { client, property } = this;
    if (!client || !property) return { configured: false };

    return this.cached(`ga4:realtime:${property}`, REALTIME_CACHE_TTL_SECONDS, async () => {
      const [response] = await client
        .runRealtimeReport({ property, metrics: [{ name: 'activeUsers' }] })
        .catch((err: unknown) => this.toUpstreamError(err));
      return {
        configured: true as const,
        activeUsers: metricOf(rowsOf(response)[0], 0),
        generatedAt: new Date().toISOString(),
      };
    });
  }

  private async fetchReport(client: Ga4DataClient, property: string, range: AnalyticsRange): Promise<AnalyticsReport> {
    const days = ANALYTICS_RANGE_DAYS[range];
    const current = { name: 'current', startDate: `${days - 1}daysAgo`, endDate: 'today' };
    const previous = { name: 'previous', startDate: `${days * 2 - 1}daysAgo`, endDate: `${days}daysAgo` };

    // Data API cho tối đa 5 báo cáo mỗi batch, nên chia làm hai batch chạy song song.
    const trafficRequests: Ga4ReportRequest[] = [
      { dateRanges: [current, previous], metrics: KPI_METRICS.map((name) => ({ name })) },
      { dateRanges: [current], dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }] },
      {
        dateRanges: [current],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'totalUsers' }, { name: 'eventCount' }],
        dimensionFilter: inListFilter('eventName', FUNNEL_EVENTS),
      },
      {
        dateRanges: [current],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagementRate' }],
        orderBys: orderByMetricDesc('sessions'),
        limit: TOP_LIMIT,
      },
      {
        dateRanges: [current],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
        orderBys: orderByMetricDesc('screenPageViews'),
        limit: TOP_LIMIT,
      },
    ];
    const audienceRequests: Ga4ReportRequest[] = [
      {
        dateRanges: [current],
        dimensions: [{ name: 'itemName' }],
        metrics: [{ name: 'itemsViewed' }, { name: 'itemsAddedToCart' }, { name: 'itemsPurchased' }],
        orderBys: orderByMetricDesc('itemsViewed'),
        limit: TOP_LIMIT,
      },
      {
        dateRanges: [current],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: orderByMetricDesc('activeUsers'),
      },
      {
        dateRanges: [current],
        dimensions: [{ name: 'city' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: orderByMetricDesc('activeUsers'),
        limit: TOP_LIMIT,
      },
      {
        dateRanges: [current],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
        dimensionFilter: inListFilter('eventName', FEATURE_EVENTS),
      },
    ];

    const [[traffic], [audience]] = await Promise.all([
      client.batchRunReports({ property, requests: trafficRequests }),
      client.batchRunReports({ property, requests: audienceRequests }),
    ]).catch((err: unknown) => this.toUpstreamError(err));

    const [kpiReport, trendReport, funnelReport, channelReport, pageReport] = traffic.reports ?? [];
    const [productReport, deviceReport, cityReport, featureReport] = audience.reports ?? [];

    const trendByDate = new Map(rowsOf(trendReport).map((row) => [toIsoDate(dimensionOf(row)), row]));
    const funnelByEvent = new Map(rowsOf(funnelReport).map((row) => [dimensionOf(row), row]));
    const featureByEvent = new Map(rowsOf(featureReport).map((row) => [dimensionOf(row), row]));

    return {
      configured: true,
      range,
      generatedAt: new Date().toISOString(),
      kpis: { current: this.toKpis(kpiReport, 'current'), previous: this.toKpis(kpiReport, 'previous') },
      trend: lastDays(days).map((date) => ({
        date,
        activeUsers: metricOf(trendByDate.get(date), 0),
        sessions: metricOf(trendByDate.get(date), 1),
      })),
      funnel: FUNNEL_EVENTS.map((event) => ({
        event,
        users: metricOf(funnelByEvent.get(event), 0),
        events: metricOf(funnelByEvent.get(event), 1),
      })),
      channels: rowsOf(channelReport).map((row) => ({
        channel: dimensionOf(row),
        sessions: metricOf(row, 0),
        activeUsers: metricOf(row, 1),
        engagementRate: metricOf(row, 2),
      })),
      topPages: rowsOf(pageReport).map((row) => ({
        path: dimensionOf(row),
        views: metricOf(row, 0),
        activeUsers: metricOf(row, 1),
      })),
      topProducts: rowsOf(productReport).map((row) => ({
        name: dimensionOf(row),
        views: metricOf(row, 0),
        addedToCart: metricOf(row, 1),
        purchased: metricOf(row, 2),
      })),
      devices: rowsOf(deviceReport).map((row) => ({ device: dimensionOf(row), activeUsers: metricOf(row, 0) })),
      cities: rowsOf(cityReport).map((row) => ({ city: dimensionOf(row), activeUsers: metricOf(row, 0) })),
      features: FEATURE_EVENTS.map((event) => ({
        event,
        count: metricOf(featureByEvent.get(event), 0),
        users: metricOf(featureByEvent.get(event), 1),
      })),
    };
  }

  /** Báo cáo có hai dateRange đặt tên nên GA4 thêm dimension dateRange vào mỗi row. */
  private toKpis(report: Ga4ReportResponse | undefined, rangeName: string): AnalyticsKpis {
    const row = rowsOf(report).find((r) => r.dimensionValues?.some((d) => d.value === rangeName));
    return {
      activeUsers: metricOf(row, 0),
      newUsers: metricOf(row, 1),
      sessions: metricOf(row, 2),
      engagementRate: metricOf(row, 3),
      averageSessionDuration: metricOf(row, 4),
      screenPageViews: metricOf(row, 5),
      purchases: metricOf(row, 6),
    };
  }

  private async cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const hit = await this.redisService.get(key);
    if (hit) return JSON.parse(hit) as T;

    // Nhiều admin mở tab cùng lúc khi cache vừa hết hạn thì chỉ gọi GA4 một lần.
    const pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const request = load()
      .then(async (value) => {
        await this.redisService.set(key, JSON.stringify(value), ttlSeconds);
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  private toUpstreamError(err: unknown): never {
    const code = (err as { code?: unknown })?.code;
    this.logger.error(
      `GA4 Data API lỗi | code=${String(code ?? 'unknown')} | ${err instanceof Error ? err.message : String(err)}`,
    );

    const message =
      code === GRPC_PERMISSION_DENIED
        ? 'Service account chưa có quyền đọc property GA4. Hãy thêm email service account với vai trò Viewer trong GA4.'
        : code === GRPC_RESOURCE_EXHAUSTED
          ? 'Đã hết quota Google Analytics Data API, vui lòng thử lại sau.'
          : 'Không lấy được dữ liệu từ Google Analytics, vui lòng thử lại sau.';
    throw new BadGatewayException({ code: 'ANALYTICS_UPSTREAM_ERROR', message });
  }
}
