import { FactoryProvider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { GA4_DATA_CLIENT } from './constants/analytics.constants';
import { Ga4DataClient } from './types/admin-analytics.types';

const logger = new Logger('Ga4DataClient');

/**
 * Tạo client GA4 Data API từ key service account (JSON gốc hoặc base64 của JSON).
 * Thiếu hoặc sai key thì trả về null để tab Phân tích báo "chưa cấu hình" thay vì
 * làm app không khởi động được.
 */
export function createGa4DataClient(rawKey?: string): Ga4DataClient | null {
  const value = rawKey?.trim();
  if (!value) return null;

  try {
    const json = value.startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8');
    const { client_email, private_key } = JSON.parse(json) as { client_email?: string; private_key?: string };
    if (!client_email || !private_key) throw new Error('missing client_email or private_key');
    return new BetaAnalyticsDataClient({ credentials: { client_email, private_key } });
  } catch {
    // Không log err.message: lỗi JSON.parse trích một đoạn nội dung key.
    logger.warn('GA4_SERVICE_ACCOUNT_JSON_BASE64 không hợp lệ, tắt báo cáo GA4.');
    return null;
  }
}

export const ga4DataClientProvider: FactoryProvider<Ga4DataClient | null> = {
  provide: GA4_DATA_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) =>
    createGa4DataClient(configService.get<string>('GA4_SERVICE_ACCOUNT_JSON_BASE64')),
};
