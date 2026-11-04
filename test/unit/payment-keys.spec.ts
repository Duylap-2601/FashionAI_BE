import { paymentSucceededEventKey, paymentTransactionId } from '../../src/modules/payments/utils/payment-keys.util';

describe('paymentSucceededEventKey', () => {
  it('xác nhận tay hai đơn cùng ghi chú không đụng khoá chống trùng', () => {
    // Admin hay gõ cùng một ghi chú ("đã nhận tiền"); trước đây đơn thứ hai bị bỏ qua.
    const note = { reference: 'đã nhận tiền', confirmedBy: 'admin-1' };
    const first = paymentSucceededEventKey('MANUAL_ADMIN', 'order-1', note);
    const second = paymentSucceededEventKey('MANUAL_ADMIN', 'order-2', note);
    expect(first).not.toBe(second);
    expect(second).toBe('payment:MANUAL_ADMIN:order-2');
  });

  it('thanh toán qua cổng vẫn khoá theo mã giao dịch để một khoản tiền không ghi cho hai đơn', () => {
    expect(paymentSucceededEventKey('ZALOPAY', 'order-1', { transId: 'zp-123' })).toBe('payment:ZALOPAY:zp-123');
    expect(paymentSucceededEventKey('ZALOPAY', 'order-2', { transId: 'zp-123' })).toBe('payment:ZALOPAY:zp-123');
    expect(paymentSucceededEventKey('SEPAY', 'order-1', { reference: 'FT2611' })).toBe('payment:SEPAY:FT2611');
  });

  it('mã giao dịch xác nhận tay gắn mã đơn, cổng thanh toán giữ mã của cổng', () => {
    const note = { reference: 'đã nhận tiền' };
    expect(paymentTransactionId('MANUAL_ADMIN', 23824554, note)).toBe('23824554:đã nhận tiền');
    expect(paymentTransactionId('MANUAL_ADMIN', 56080018, note)).toBe('56080018:đã nhận tiền');
    expect(paymentTransactionId('SEPAY', 56080018, { reference: 'FT2611' })).toBe('FT2611');
    expect(paymentTransactionId('ZALOPAY', 56080018, { transId: 'zp-123' })).toBe('zp-123');
  });
});
