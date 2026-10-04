export type GatewayCode = 'MOMO' | 'ZALOPAY';
export type GatewayResultStatus = 'SUCCESS' | 'FAILED' | 'PENDING';

export interface GatewayCreateInput {
  paymentId: string;
  orderCode: number;
  userId: string;
  providerOrderId: string;
  requestId: string;
  amountVnd: number;
  description: string;
  redirectUrl: string;
  expiresAt: Date;
}

export interface GatewayCreateResult {
  checkoutUrl: string;
  payUrl?: string;
  deeplink?: string;
  qrCodeUrl?: string;
  qrCode?: string;
  raw: Record<string, unknown>;
}

export interface GatewayPaymentResult {
  providerOrderId: string;
  amountVnd: number;
  status: GatewayResultStatus;
  transactionId?: string;
  requestId?: string;
  eventKey: string;
  failureReason?: string;
  raw: Record<string, unknown>;
}

export interface GatewayRefundInput {
  refundId: string;
  requestId: string;
  transactionId: string;
  amountVnd: number;
  description: string;
}

export interface GatewayRefundResult {
  status: GatewayResultStatus;
  message?: string;
  providerRefundRef?: string;
  raw: Record<string, unknown>;
}

export interface PaymentGateway {
  readonly code: GatewayCode;
  readonly checkoutTtlMs: number;
  readonly linkReuseMs: number;
  buildProviderOrderId(orderCode: number, now?: Date): string;
  buildRefundId(orderCode: number, now?: Date): string;
  createPayment(input: GatewayCreateInput): Promise<GatewayCreateResult>;
  parseCallback(body: unknown): GatewayPaymentResult;
  refund(input: GatewayRefundInput): Promise<GatewayRefundResult>;
  queryPayment?(providerOrderId: string, requestId: string, opts?: { pastExpiry: boolean }): Promise<GatewayPaymentResult>;
  queryRefund?(refundId: string): Promise<GatewayRefundResult>;
}
