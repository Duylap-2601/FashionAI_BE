/**
 * Ngày quota tính theo giờ Việt Nam (UTC+7, không có DST) để key đếm lượt,
 * TTL Redis và mốc reset hiển thị cho user khớp nhau. Nếu dùng UTC, lượt sẽ
 * reset lúc 07:00 giờ Việt Nam dù UI ghi "hết ngày".
 */
const QUOTA_OFFSET_MS = 7 * 60 * 60 * 1000;

export function quotaDateKey(now: Date = new Date()): string {
  return new Date(now.getTime() + QUOTA_OFFSET_MS).toISOString().slice(0, 10);
}

export function nextQuotaReset(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + QUOTA_OFFSET_MS);
  const nextDayUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1);
  return new Date(nextDayUtc - QUOTA_OFFSET_MS);
}

export function secondsUntilQuotaReset(now: Date = new Date()): number {
  return Math.max(1, Math.ceil((nextQuotaReset(now).getTime() - now.getTime()) / 1000));
}
