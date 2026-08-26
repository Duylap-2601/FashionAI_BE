import { Logger } from '@nestjs/common';

/**
 * Nguồn sự thật duy nhất cho CORS origin, dùng chung cho HTTP (enableCors) và
 * WebSocket gateway. Thêm domain FE ở một chỗ để không lệch giữa hai transport.
 */
export function parseCorsOrigins(
  value: string | undefined,
  credentials: boolean,
  isProduction: boolean,
  logger: Logger,
): string | string[] {
  const explicit = value && value.trim() !== '*';

  if (isProduction && !explicit) {
    // Production không được mở CORS cho '*' hay ngầm rơi về localhost. Bắt buộc
    // khai báo CORS_ORIGINS để tránh vô tình để lộ API cho mọi domain.
    logger.warn(
      'CORS_ORIGINS chưa được cấu hình ở production. Chỉ cho phép localhost tạm thời — ' +
        'hãy đặt CORS_ORIGINS=<domain FE> để khóa đúng domain.',
    );
    return ['http://localhost:3000', 'http://127.0.0.1:3000'];
  }

  if (!explicit) {
    return credentials
      ? ['http://localhost:3000', 'http://127.0.0.1:3000']
      : '*';
  }

  return value
    .split(',')
    // Header `Origin` của browser không bao giờ có dấu / cuối, mà package `cors`
    // so khớp bằng chuỗi tuyệt đối. Đặt CORS_ORIGINS=https://foo.app/ sẽ âm thầm
    // chặn hết request từ chính domain đó, nên chuẩn hoá tại đây.
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}
