type PaymentReference = { transId?: unknown; reference?: unknown } | null | undefined;

/**
 * Mã giao dịch lưu trên Payment (unique theo provider). Cổng thanh toán dùng mã giao
 * dịch của cổng. Xác nhận tay gắn thêm mã đơn: mã sao kê / ghi chú admin nhập không
 * duy nhất, hai đơn cùng ghi chú sẽ đụng unique và đơn sau không được ghi nhận.
 */
export function paymentTransactionId(provider: string, orderCode: number, paymentData?: PaymentReference): string {
  const reference = String(paymentData?.transId ?? paymentData?.reference ?? Date.now());
  return provider === 'MANUAL_ADMIN' ? `${orderCode}:${reference}` : reference;
}

/**
 * Khoá chống trùng cho sự kiện "thanh toán thành công" (`OrderEvent.deduplicationKey`
 * là unique toàn hệ thống). Thanh toán qua cổng khoá theo mã giao dịch để một khoản
 * tiền không được ghi cho hai đơn. Xác nhận tay khoá theo đơn: mã sao kê / ghi chú
 * admin nhập không phải mã giao dịch duy nhất, hai đơn cùng ghi chú sẽ đụng khoá và
 * đơn sau bị bỏ qua ("Payment already processed") dù chưa được ghi nhận thanh toán.
 */
export function paymentSucceededEventKey(
  provider: string,
  orderId: string,
  paymentData?: PaymentReference,
): string {
  if (provider === 'MANUAL_ADMIN') return `payment:MANUAL_ADMIN:${orderId}`;
  return `payment:${provider}:${paymentData?.transId ?? paymentData?.reference ?? Date.now()}`;
}
