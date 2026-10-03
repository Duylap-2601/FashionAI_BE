import {
  calcUpgradeProration,
  roundUpVnd,
} from '../../src/common/constants/subscription-plans.constants';

describe('roundUpVnd', () => {
  it('làm tròn lên 1.000đ', () => {
    expect(roundUpVnd(24500)).toBe(25000);
    expect(roundUpVnd(25000)).toBe(25000);
    expect(roundUpVnd(1633.33)).toBe(2000);
    expect(roundUpVnd(0)).toBe(0);
  });
});

describe('calcUpgradeProration', () => {
  it('MEMBER -> VIP còn 15 ngày: credit 17k, debit 50k, net 33k', () => {
    const result = calcUpgradeProration('MEMBER', 'VIP', 15);
    expect(result).toEqual({
      oldTier: 'MEMBER',
      newTier: 'VIP',
      remainingDays: 15,
      credit: 17000,
      debit: 50000,
      net: 33000,
    });
  });

  it('MEMBER -> VIP full 30 ngày: net bằng chênh lệch giá gói', () => {
    const result = calcUpgradeProration('MEMBER', 'VIP', 30);
    expect(result.credit).toBe(34000);
    expect(result.debit).toBe(99000);
    expect(result.net).toBe(65000);
  });

  it('net không bao giờ âm', () => {
    const result = calcUpgradeProration('VIP', 'VIP', 10);
    expect(result.net).toBeGreaterThanOrEqual(0);
  });
});
