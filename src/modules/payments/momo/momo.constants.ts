export const MOMO_PROVIDER = 'MOMO';
export const MOMO_SUCCESS_RESULT_CODE = 0;

export const MOMO_CREATE_SIGNATURE_FIELDS = [
  'accessKey',
  'amount',
  'extraData',
  'ipnUrl',
  'orderId',
  'orderInfo',
  'partnerCode',
  'redirectUrl',
  'requestId',
  'requestType',
] as const;

export const MOMO_IPN_SIGNATURE_FIELDS = [
  'accessKey',
  'amount',
  'extraData',
  'message',
  'orderId',
  'orderInfo',
  'orderType',
  'partnerCode',
  'payType',
  'requestId',
  'responseTime',
  'resultCode',
  'transId',
] as const;

export const MOMO_QUERY_SIGNATURE_FIELDS = [
  'accessKey',
  'orderId',
  'partnerCode',
  'requestId',
] as const;

export const MOMO_REFUND_SIGNATURE_FIELDS = [
  'accessKey',
  'amount',
  'description',
  'orderId',
  'partnerCode',
  'requestId',
  'transId',
] as const;
