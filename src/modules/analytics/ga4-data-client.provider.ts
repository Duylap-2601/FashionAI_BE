import { FactoryProvider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { GA4_DATA_CLIENT } from './constants/analytics.constants';
import { Ga4DataClient } from './types/admin-analytics.types';

const logger = new Logger('Ga4DataClient');

/**
 * Tạo client GA4 Data API từ email + private key của service account. Thiếu một
 * trong hai thì trả về null để tab Phân tích báo "chưa cấu hình" thay vì làm app
 * không khởi động được.
 */
export function createGa4DataClient(clientEmail?: string, privateKey?: string): Ga4DataClient | null {
  const email = clientEmail?.trim();
  // Biến môi trường trên Render/Docker thường giữ nguyên chuỗi "\n" thay vì xuống
  // dòng thật; key PEM phải có xuống dòng thật mới ký được JWT.
  const key = privateKey?.replace(/\\n/g, '\n').trim();
  if (!email || !key) return null;

  if (!key.includes('BEGIN PRIVATE KEY')) {
    // Không log giá trị key, chỉ báo sai định dạng.
    logger.warn('GA_PRIVATE_KEY không đúng định dạng PEM, tắt báo cáo GA4.');
    return null;
  }

  return new BetaAnalyticsDataClient({ credentials: { client_email: email, private_key: key } });
}

export const ga4DataClientProvider: FactoryProvider<Ga4DataClient | null> = {
  provide: GA4_DATA_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) =>
    createGa4DataClient(
      configService.get<string>('GA_SERVICE_ACCOUNT_EMAIL'),
      configService.get<string>('GA_PRIVATE_KEY'),
    ),
};
