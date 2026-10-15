import { protos } from '@google-analytics/data';
import { AnalyticsRange, FeatureEvent, FunnelEvent } from '../constants/analytics.constants';

export type Ga4ReportRequest = protos.google.analytics.data.v1beta.IRunReportRequest;
export type Ga4ReportResponse = protos.google.analytics.data.v1beta.IRunReportResponse;

/** Phần nhỏ của BetaAnalyticsDataClient mà module dùng; tách ra để test thay bằng mock. */
export interface Ga4DataClient {
  batchRunReports(
    request: protos.google.analytics.data.v1beta.IBatchRunReportsRequest,
  ): Promise<[protos.google.analytics.data.v1beta.IBatchRunReportsResponse, ...unknown[]]>;
  runRealtimeReport(
    request: protos.google.analytics.data.v1beta.IRunRealtimeReportRequest,
  ): Promise<[protos.google.analytics.data.v1beta.IRunRealtimeReportResponse, ...unknown[]]>;
}

export interface AnalyticsKpis {
  activeUsers: number;
  newUsers: number;
  sessions: number;
  engagementRate: number;
  averageSessionDuration: number;
  screenPageViews: number;
  purchases: number;
}

export interface AnalyticsReport {
  configured: true;
  range: AnalyticsRange;
  generatedAt: string;
  kpis: { current: AnalyticsKpis; previous: AnalyticsKpis };
  trend: { date: string; activeUsers: number; sessions: number }[];
  funnel: { event: FunnelEvent; users: number; events: number }[];
  channels: { channel: string; sessions: number; activeUsers: number; engagementRate: number }[];
  topPages: { path: string; views: number; activeUsers: number }[];
  topProducts: { name: string; views: number; addedToCart: number; purchased: number }[];
  devices: { device: string; activeUsers: number }[];
  cities: { city: string; activeUsers: number }[];
  features: { event: FeatureEvent; count: number; users: number }[];
}

export interface AnalyticsRealtime {
  configured: true;
  activeUsers: number;
  generatedAt: string;
}

export interface AnalyticsNotConfigured {
  configured: false;
}
