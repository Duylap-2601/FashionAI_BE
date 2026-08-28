export type Platform = 'mobile' | 'web';

export const PLATFORM_HEADER = 'x-platform' as const;
export const DEFAULT_PLATFORM: Platform = 'web';

// Fail-closed: mọi giá trị không phải đúng 'mobile' (thiếu, string[] do query param
// lặp, rác) đều thành 'web', tức refresh token đi vào HttpOnly cookie chứ không lộ
// ra response body.
export function normalizePlatform(raw: unknown): Platform {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'mobile'
    ? 'mobile'
    : DEFAULT_PLATFORM;
}
