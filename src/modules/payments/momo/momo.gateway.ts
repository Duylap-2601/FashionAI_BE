import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { MomoIpnDto } from '../dto/momo-ipn.dto';
import {
  GatewayCreateInput,
  GatewayCreateResult,
  GatewayPaymentResult,
  GatewayRefundInput,
  GatewayRefundResult,
  PaymentGateway,
} from '../gateways/payment-gateway.types';
import { MOMO_PROVIDER, MOMO_SUCCESS_RESULT_CODE } from './momo.constants';
import { MomoPaymentProvider } from './momo-payment.provider';

@Injectable()
export class MomoGateway implements PaymentGateway {
  readonly code = MOMO_PROVIDER as 'MOMO';
  readonly checkoutTtlMs = 24 * 60 * 60 * 1000;
  readonly linkReuseMs = 90 * 60 * 1000;

  constructor(private readonly provider: MomoPaymentProvider) {}

  buildProviderOrderId(orderCode: number) {
    return `MOMO_${orderCode}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  }

  buildRefundId(orderCode: number) {
    return `MOMO_REFUND_${orderCode}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  }

  async createPayment(input: GatewayCreateInput): Promise<GatewayCreateResult> {
    const extraData = Buffer.from(JSON.stringify({ paymentId: input.paymentId })).toString('base64');
    const raw = await this.provider.createPayment({
      amount: input.amountVnd,
      orderId: input.providerOrderId,
      requestId: input.requestId,
      orderInfo: input.description,
      extraData,
      redirectUrl: input.redirectUrl,
    });
    const checkoutUrl = String(raw.payUrl ?? raw.deeplink ?? raw.qrCodeUrl ?? '');
    return {
      checkoutUrl,
      payUrl: raw.payUrl ? String(raw.payUrl) : undefined,
      deeplink: raw.deeplink ? String(raw.deeplink) : undefined,
      qrCodeUrl: raw.qrCodeUrl ? String(raw.qrCodeUrl) : undefined,
      raw,
    };
  }

  parseCallback(body: unknown): GatewayPaymentResult {
    const payload = body as MomoIpnDto & Record<string, unknown>;
    this.provider.verifyIpn(payload);
    const transId = payload.transId === undefined || payload.transId === null ? '' : String(payload.transId);
    const resultCode = Number(payload.resultCode);
    return {
      providerOrderId: String(payload.orderId),
      requestId: String(payload.requestId),
      amountVnd: Number(payload.amount),
      status: resultCode === MOMO_SUCCESS_RESULT_CODE ? 'SUCCESS' : 'FAILED',
      transactionId: transId || undefined,
      eventKey: `MOMO:${payload.orderId}:${payload.requestId}:${resultCode}:${transId}`,
      failureReason: resultCode === MOMO_SUCCESS_RESULT_CODE ? undefined : String(payload.message ?? `MoMo resultCode=${payload.resultCode}`),
      raw: payload,
    };
  }

  async refund(input: GatewayRefundInput): Promise<GatewayRefundResult> {
    const raw = await this.provider.refundPayment({
      amount: input.amountVnd,
      orderId: input.refundId,
      requestId: input.requestId,
      transId: input.transactionId,
      description: input.description,
    });
    const resultCode = Number(raw.resultCode);
    return {
      status: resultCode === MOMO_SUCCESS_RESULT_CODE ? 'SUCCESS' : 'FAILED',
      message: String(raw.message ?? `MoMo refund resultCode=${raw.resultCode}`),
      raw,
    };
  }
}
