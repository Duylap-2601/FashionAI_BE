import { PaymentStatus } from '@prisma/client';
import {
  resolveManualRefundAmount,
  resolveRefundPaymentStatus,
} from '../../src/common/utils/refund.util';

describe('resolveRefundPaymentStatus', () => {
  it('giữ PAID khi chưa hoàn đồng nào', () => {
    expect(resolveRefundPaymentStatus(1_000_000, 0)).toBe(PaymentStatus.PAID);
  });

  it('trả PARTIALLY_REFUNDED khi hoàn một phần', () => {
    expect(resolveRefundPaymentStatus(1_000_000, 300_000)).toBe(PaymentStatus.PARTIALLY_REFUNDED);
  });

  it('trả REFUNDED khi hoàn đủ hoặc vượt số đã thu', () => {
    expect(resolveRefundPaymentStatus(1_000_000, 1_000_000)).toBe(PaymentStatus.REFUNDED);
    expect(resolveRefundPaymentStatus(1_000_000, 1_200_000)).toBe(PaymentStatus.REFUNDED);
  });
});

describe('resolveManualRefundAmount', () => {
  it('mặc định hoàn toàn bộ phần còn lại khi admin không nhập số tiền', () => {
    expect(
      resolveManualRefundAmount({ collectedVnd: 1_000_000, completedVnd: 200_000 }),
    ).toEqual({ amountVnd: 800_000, remainingVnd: 800_000 });
  });

  it('ưu tiên số tiền admin nhập cho lần hoàn một phần', () => {
    expect(
      resolveManualRefundAmount({
        collectedVnd: 1_000_000,
        completedVnd: 0,
        requestedVnd: 300_000,
      }),
    ).toEqual({ amountVnd: 300_000, remainingVnd: 1_000_000 });
  });

  it('dùng số đã duyệt trên bản ghi refund đang mở', () => {
    expect(
      resolveManualRefundAmount({
        collectedVnd: 1_000_000,
        completedVnd: 0,
        openAmountVnd: 400_000,
      }),
    ).toEqual({ amountVnd: 400_000, remainingVnd: 1_000_000 });
  });

  it('chặn số đã duyệt cũ bằng phần còn lại của đơn', () => {
    expect(
      resolveManualRefundAmount({
        collectedVnd: 1_000_000,
        completedVnd: 700_000,
        openAmountVnd: 500_000,
      }),
    ).toEqual({ amountVnd: 300_000, remainingVnd: 300_000 });
  });

  it('trả 0 khi đã hoàn đủ', () => {
    expect(
      resolveManualRefundAmount({ collectedVnd: 1_000_000, completedVnd: 1_000_000 }),
    ).toEqual({ amountVnd: 0, remainingVnd: 0 });
  });
});
