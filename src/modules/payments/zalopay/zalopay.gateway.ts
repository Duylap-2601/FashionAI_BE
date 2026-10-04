import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { ZaloPayModule } from 'zalopay-sdk';
import {
  GatewayCreateInput,
  GatewayCreateResult,
  GatewayPaymentResult,
  GatewayRefundInput,
  GatewayRefundResult,
  PaymentGateway,
} from '../gateways/payment-gateway.types';
import {
  ZALOPAY_EXPIRED_SUB_RETURN_CODE,
  ZALOPAY_FAILED_RETURN_CODE,
  ZALOPAY_PENDING_RETURN_CODE,
  ZALOPAY_PROVIDER,
  ZALOPAY_QUERY_SYSTEM_ERROR_SUBCODES,
  ZALOPAY_QUERY_UNPAID_SUBCODES,
  ZALOPAY_REFUND_FAILED_SUBCODES,
  ZALOPAY_SUCCESS_RETURN_CODE,
} from './zalopay.constants';

@Injectable()
export class ZaloPayGateway implements PaymentGateway {
  readonly code = ZALOPAY_PROVIDER as 'ZALOPAY';
  readonly checkoutTtlMs = 15 * 60 * 1000;
  readonly linkReuseMs = 14 * 60 * 1000;
  private client?: ZaloPayModule;

  constructor(private readonly config: ConfigService) {}

  buildProviderOrderId(orderCode: number, _now = new Date()) {
    const suffix = `${orderCode}${crypto.randomBytes(3).toString('hex')}`;
    return this.getClient().generateAppTransId(suffix).slice(0, 40);
  }

  buildRefundId(orderCode: number, now = new Date()) {
    return `${this.yyMMddGmt7(now)}_${this.requireConfig('ZALOPAY_APP_ID')}_${orderCode}${crypto.randomBytes(4).toString('hex')}`.slice(0, 40);
  }

  async createPayment(input: GatewayCreateInput): Promise<GatewayCreateResult> {
    const redirecturl = this.buildRedirectUrl(input);
    const raw = await this.getClient().createOrder({
      app_trans_id: input.providerOrderId,
      app_user: input.userId,
      amount: input.amountVnd,
      item: [],
      embed_data: { paymentId: input.paymentId },
      description: input.description.slice(0, 256),
      bank_code: '',
      callback_url: this.requireConfig('ZALOPAY_CALLBACK_URL'),
      redirect_url: redirecturl,
    });
    if (Number(raw.return_code) !== ZALOPAY_SUCCESS_RETURN_CODE) {
      throw new BadRequestException(String(raw.sub_return_message ?? raw.return_message ?? 'ZaloPay create payment failed'));
    }
    const checkoutUrl = String(raw.order_url ?? '');
    return {
      checkoutUrl,
      payUrl: checkoutUrl,
      qrCode: raw.qr_code ? String(raw.qr_code) : undefined,
      raw: raw as unknown as Record<string, unknown>,
    };
  }

  parseCallback(body: unknown): GatewayPaymentResult {
    const envelope = body as { data?: unknown; mac?: unknown };
    if (typeof envelope?.data !== 'string' || typeof envelope?.mac !== 'string') {
      throw new BadRequestException('Invalid ZaloPay callback envelope');
    }
    if (!this.getClient().verifyCallback(envelope.data, envelope.mac)) {
      throw new BadRequestException('Invalid ZaloPay callback mac');
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(envelope.data) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Invalid ZaloPay callback data');
    }
    if (String(data.app_id) !== this.requireConfig('ZALOPAY_APP_ID')) {
      throw new BadRequestException('Invalid ZaloPay app_id');
    }
    const providerOrderId = String(data.app_trans_id ?? '');
    const transactionId = String(data.zp_trans_id ?? '');
    return {
      providerOrderId,
      amountVnd: Number(data.amount),
      status: 'SUCCESS',
      transactionId,
      eventKey: `ZALOPAY:${providerOrderId}:${transactionId}`,
      raw: data,
    };
  }

  async queryPayment(providerOrderId: string, _requestId: string, opts?: { pastExpiry: boolean }): Promise<GatewayPaymentResult> {
    const raw = await this.getClient().queryOrder(providerOrderId);
    const returnCode = Number(raw.return_code);
    const subReturnCode = Number(raw.sub_return_code);
    if (returnCode === ZALOPAY_SUCCESS_RETURN_CODE) {
      const transactionId = String(raw.zp_trans_id ?? '');
      return { providerOrderId, amountVnd: Number(raw.amount), status: 'SUCCESS', transactionId, eventKey: `ZALOPAY:${providerOrderId}:${transactionId}`, raw: raw as unknown as Record<string, unknown> };
    }
    if (returnCode === ZALOPAY_FAILED_RETURN_CODE) {
      if (subReturnCode === ZALOPAY_EXPIRED_SUB_RETURN_CODE || (opts?.pastExpiry && ZALOPAY_QUERY_UNPAID_SUBCODES.has(subReturnCode))) {
        return { providerOrderId, amountVnd: Number(raw.amount ?? 0), status: 'FAILED', eventKey: `ZALOPAY:${providerOrderId}:FAILED`, failureReason: String(raw.sub_return_message ?? raw.return_message ?? 'ZaloPay payment failed'), raw: raw as unknown as Record<string, unknown> };
      }
      if (ZALOPAY_QUERY_SYSTEM_ERROR_SUBCODES.has(subReturnCode) || !ZALOPAY_QUERY_UNPAID_SUBCODES.has(subReturnCode)) {
        throw new Error(String(raw.sub_return_message ?? raw.return_message ?? 'ZaloPay query failed'));
      }
    }
    if (returnCode === ZALOPAY_PENDING_RETURN_CODE || returnCode === ZALOPAY_FAILED_RETURN_CODE) {
      return { providerOrderId, amountVnd: Number(raw.amount ?? 0), status: 'PENDING', eventKey: `ZALOPAY:${providerOrderId}:PENDING`, raw: raw as unknown as Record<string, unknown> };
    }
    throw new Error(String(raw.return_message ?? 'ZaloPay query failed'));
  }

  async refund(input: GatewayRefundInput): Promise<GatewayRefundResult> {
    const raw = await this.getClient().refund({
      m_refund_id: input.refundId,
      zp_trans_id: input.transactionId,
      amount: input.amountVnd,
      description: input.description,
    });
    const returnCode = Number(raw.return_code);
    return {
      status: returnCode === ZALOPAY_FAILED_RETURN_CODE ? 'FAILED' : 'PENDING',
      message: String(raw.return_message ?? raw.sub_return_message ?? ''),
      providerRefundRef: String(raw.refund_id ?? input.refundId),
      raw: raw as unknown as Record<string, unknown>,
    };
  }

  async queryRefund(refundId: string): Promise<GatewayRefundResult> {
    const raw = await this.getClient().queryRefund(refundId);
    const returnCode = Number(raw.return_code);
    const subReturnCode = Number(raw.sub_return_code);
    if (returnCode === ZALOPAY_SUCCESS_RETURN_CODE) return { status: 'SUCCESS', raw: raw as unknown as Record<string, unknown> };
    if (returnCode === ZALOPAY_FAILED_RETURN_CODE && ZALOPAY_REFUND_FAILED_SUBCODES.has(subReturnCode)) {
      return { status: 'FAILED', message: String(raw.sub_return_message ?? raw.return_message ?? 'ZaloPay refund failed'), raw: raw as unknown as Record<string, unknown> };
    }
    return { status: 'PENDING', message: String(raw.sub_return_message ?? raw.return_message ?? ''), raw: raw as unknown as Record<string, unknown> };
  }

  private yyMMddGmt7(date: Date) {
    const gmt7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    return `${String(gmt7.getUTCFullYear()).slice(2)}${String(gmt7.getUTCMonth() + 1).padStart(2, '0')}${String(gmt7.getUTCDate()).padStart(2, '0')}`;
  }

  private buildRedirectUrl(input: GatewayCreateInput) {
    const configured = this.config.get<string>('ZALOPAY_REDIRECT_URL');
    const url = new URL(configured || input.redirectUrl);
    url.searchParams.set('paymentId', input.paymentId);
    return url.toString();
  }

  private getClient() {
    if (!this.client) {
      this.client = new ZaloPayModule({
        appId: this.requireConfig('ZALOPAY_APP_ID'),
        key1: this.requireConfig('ZALOPAY_KEY1'),
        key2: this.requireConfig('ZALOPAY_KEY2'),
        env: this.config.get<string>('ZALOPAY_ENV', 'sandbox') === 'production' ? 'production' : 'sandbox',
      });
    }
    return this.client;
  }

  private requireConfig(key: string) {
    const value = this.config.get<string>(key);
    if (!value) throw new BadRequestException(`${key} is required for ZaloPay payments`);
    return value;
  }
}
