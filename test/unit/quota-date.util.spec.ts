import {
  nextQuotaReset,
  quotaDateKey,
  secondsUntilQuotaReset,
} from '../../src/common/utils/quota-date.util';

describe('quota date helpers', () => {
  it('rolls the quota day over at Vietnam midnight, not UTC midnight', () => {
    expect(quotaDateKey(new Date('2026-11-01T16:59:59Z'))).toBe('2026-11-01');
    expect(quotaDateKey(new Date('2026-11-01T17:00:00Z'))).toBe('2026-11-02');
  });

  it('returns the next Vietnam midnight as the reset time', () => {
    expect(nextQuotaReset(new Date('2026-11-01T20:00:00Z')).toISOString()).toBe('2026-11-02T17:00:00.000Z');
  });

  it('keeps the Redis TTL aligned with the date key', () => {
    expect(secondsUntilQuotaReset(new Date('2026-11-01T16:59:00Z'))).toBe(60);
  });
});
