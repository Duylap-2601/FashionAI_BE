import { ConfigService } from '@nestjs/config';

/**
 * Đọc một biến môi trường bắt buộc, dừng app ngay tại boot nếu thiếu.
 *
 * Fallback ngầm cho secret là lỗ hổng: app vẫn chạy bình thường nhưng bất kỳ ai
 * đọc được source đều ký được token hợp lệ. Chết sớm và ồn ào an toàn hơn nhiều.
 */
export function requireConfig(config: ConfigService, key: string): string {
  const value = config.get<string>(key)?.trim();
  if (!value) {
    throw new Error(
      `${key} là bắt buộc nhưng chưa được cấu hình. Hãy khai báo biến môi trường này trước khi khởi động app.`,
    );
  }
  return value;
}
