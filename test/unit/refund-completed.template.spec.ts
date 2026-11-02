import { renderRefundCompletedMail } from '../../src/modules/mail/templates/refund-completed.template';
import { RefundCompletedData } from '../../src/modules/mail/mail.types';

const base: RefundCompletedData & { detailUrl: string } = {
  refundId: 'refund-1',
  orderId: 'order-1',
  orderCode: 12345,
  amountVnd: 550_000,
  totalRefundedVnd: 550_000,
  provider: 'MANUAL',
  processedAt: new Date('2026-11-02T03:00:00.000Z'),
  bankName: 'Vietcombank',
  accountNumber: '0123456789',
  accountHolder: 'NGUYEN VAN A',
  receiptImages: ['https://cdn.example.com/receipt-1.jpg'],
  evidenceReference: 'VCB FT2611021234',
  detailUrl: 'https://example.com/orders/order-1',
};

describe('renderRefundCompletedMail', () => {
  it('hiển thị số tiền, tài khoản nhận và liên kết kiểm tra đơn hàng', () => {
    const mail = renderRefundCompletedMail(base);

    expect(mail.subject).toContain('Đã hoàn tiền đơn hàng #12345');
    expect(mail.html).toContain('550.000đ');
    expect(mail.html).toContain('Vietcombank');
    expect(mail.html).toContain('0123456789');
    expect(mail.html).toContain('NGUYEN VAN A');
    expect(mail.html).toContain('Chuyển khoản ngân hàng');
    expect(mail.html).toContain(base.detailUrl);
    expect(mail.text).toContain('Số tiền hoàn: 550.000đ');
    expect(mail.text).toContain('Tổng đã hoàn cho đơn: 550.000đ');
  });

  it('nhúng ảnh chứng từ và mã giao dịch vào email để khách đối chiếu', () => {
    const mail = renderRefundCompletedMail(base);

    expect(mail.html).toContain('Chứng từ chuyển khoản');
    expect(mail.html).toContain('VCB FT2611021234');
    expect(mail.html).toContain('https://cdn.example.com/receipt-1.jpg');
    expect(mail.html).toContain('<img');
    expect(mail.text).toContain('Mã giao dịch: VCB FT2611021234');
    expect(mail.text).toContain('Ảnh chứng từ 1: https://cdn.example.com/receipt-1.jpg');
  });

  it('không render khối chứng từ khi không có ảnh lẫn mã giao dịch', () => {
    const mail = renderRefundCompletedMail({
      ...base,
      receiptImages: [],
      evidenceReference: null,
    });

    expect(mail.html).not.toContain('Chứng từ chuyển khoản');
    expect(mail.text).not.toContain('Mã giao dịch:');
  });

  it('bỏ qua URL chứng từ không phải http(s)', () => {
    const mail = renderRefundCompletedMail({
      ...base,
      receiptImages: ['javascript:alert(1)'],
      evidenceReference: null,
    });

    expect(mail.html).not.toContain('javascript:alert(1)');
    expect(mail.html).not.toContain('Chứng từ chuyển khoản');
  });

  it('không hiện khối tài khoản ngân hàng cho hoàn tiền qua cổng thanh toán', () => {
    const mail = renderRefundCompletedMail({
      ...base,
      provider: 'MOMO',
      bankName: null,
      accountNumber: null,
      accountHolder: null,
    });

    expect(mail.html).toContain('Ví MoMo');
    expect(mail.html).not.toContain('Tài khoản nhận tiền');
    expect(mail.text).not.toContain('Ngân hàng:');
  });

  it('escape nội dung ngân hàng do người dùng nhập', () => {
    const mail = renderRefundCompletedMail({
      ...base,
      accountHolder: '<script>alert(1)</script>',
    });

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});
