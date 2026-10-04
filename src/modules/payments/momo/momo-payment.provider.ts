import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { MomoIpnDto } from '../dto/momo-ipn.dto';
import {
  MOMO_CREATE_SIGNATURE_FIELDS,
  MOMO_IPN_SIGNATURE_FIELDS,
  MOMO_QUERY_SIGNATURE_FIELDS,
  MOMO_REFUND_SIGNATURE_FIELDS,
} from './momo.constants';
import { MomoSignatureService } from './momo-signature.service';

interface CreateMomoPaymentInput {
  amount: number;
  orderId: string;
  orderInfo: string;
  requestId: string;
  extraData?: string;
  redirectUrl?: string;
}

interface RefundMomoPaymentInput {
  amount: number;
  orderId: string;
  requestId: string;
  transId: string;
  description: string;
}

@Injectable()
export class MomoPaymentProvider {
  private readonly logger = new Logger(MomoPaymentProvider.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly signatureService: MomoSignatureService,
  ) {}

  get partnerCode() {
    return this.requireConfig('MOMO_PARTNER_CODE');
  }

  async createPayment(input: CreateMomoPaymentInput) {
    const endpoint = this.requireConfig('MOMO_ENDPOINT');
    const accessKey = this.requireConfig('MOMO_ACCESS_KEY');
    const secretKey = this.requireConfig('MOMO_SECRET_KEY');
    const partnerCode = this.partnerCode;
    const requestType = this.requireConfig('MOMO_REQUEST_TYPE');
    const redirectUrl = input.redirectUrl ?? this.requireConfig('MOMO_REDIRECT_URL');
    const ipnUrl = this.requireConfig('MOMO_IPN_URL');
    const payload = {
      partnerCode,
      partnerName: this.configService.get<string>('MOMO_PARTNER_NAME', 'FashionAI'),
      storeId: this.configService.get<string>('MOMO_STORE_ID', 'FashionAI'),
      requestId: input.requestId,
      amount: String(input.amount),
      orderId: input.orderId,
      orderInfo: input.orderInfo,
      redirectUrl,
      ipnUrl,
      lang: this.configService.get<string>('MOMO_LANG', 'vi'),
      requestType,
      extraData: input.extraData ?? '',
      orderGroupId: this.configService.get<string>('MOMO_ORDER_GROUP_ID', ''),
      autoCapture: this.configService.get<string>('MOMO_AUTO_CAPTURE', 'true') !== 'false',
    };

    const signature = this.signatureService.sign({
      accessKey,
      amount: payload.amount,
      extraData: payload.extraData,
      ipnUrl: payload.ipnUrl,
      orderId: payload.orderId,
      orderInfo: payload.orderInfo,
      partnerCode: payload.partnerCode,
      redirectUrl: payload.redirectUrl,
      requestId: payload.requestId,
      requestType: payload.requestType,
    }, [...MOMO_CREATE_SIGNATURE_FIELDS], secretKey);
    const response = await axios.post<Record<string, unknown>>(`${endpoint.replace(/\/$/, '')}/v2/gateway/api/create`, {
      ...payload,
      signature,
    }, { timeout: 30_000 });

    return response.data;
  }

  async queryPayment(orderId: string, requestId: string) {
    const endpoint = this.requireConfig('MOMO_ENDPOINT');
    const accessKey = this.requireConfig('MOMO_ACCESS_KEY');
    const secretKey = this.requireConfig('MOMO_SECRET_KEY');
    const partnerCode = this.partnerCode;
    const payload = { partnerCode, orderId, requestId, lang: 'vi' };
    const signature = this.signatureService.sign({ ...payload, accessKey }, [...MOMO_QUERY_SIGNATURE_FIELDS], secretKey);
    const response = await axios.post<Record<string, unknown>>(`${endpoint.replace(/\/$/, '')}/v2/gateway/api/query`, {
      ...payload,
      signature,
    }, { timeout: 30_000 });
    return response.data;
  }

  async refundPayment(input: RefundMomoPaymentInput) {
    const endpoint = this.requireConfig('MOMO_ENDPOINT');
    const accessKey = this.requireConfig('MOMO_ACCESS_KEY');
    const secretKey = this.requireConfig('MOMO_SECRET_KEY');
    const partnerCode = this.partnerCode;
    const payload = {
      partnerCode,
      orderId: input.orderId,
      requestId: input.requestId,
      amount: String(input.amount),
      transId: input.transId,
      lang: this.configService.get<string>('MOMO_LANG', 'vi'),
      description: input.description,
    };
    const signature = this.signatureService.sign({ ...payload, accessKey }, [...MOMO_REFUND_SIGNATURE_FIELDS], secretKey);
    const response = await axios.post<Record<string, unknown>>(`${endpoint.replace(/\/$/, '')}/v2/gateway/api/refund`, {
      ...payload,
      signature,
    }, { timeout: 30_000 });
    return response.data;
  }

  verifyIpn(payload: MomoIpnDto & Record<string, unknown>) {
    const accessKey = this.requireConfig('MOMO_ACCESS_KEY');
    const secretKey = this.requireConfig('MOMO_SECRET_KEY');
    if (payload.partnerCode !== this.partnerCode) {
      throw new BadRequestException('Invalid MoMo partnerCode');
    }

    const valid = this.signatureService.verify(
      { ...payload, accessKey },
      [...MOMO_IPN_SIGNATURE_FIELDS],
      secretKey,
      payload.signature,
    );
    if (!valid) {
      this.logger.warn(`Invalid MoMo IPN signature | orderId=${payload.orderId} | requestId=${payload.requestId}`);
      throw new BadRequestException('Invalid MoMo signature');
    }
  }

  private requireConfig(key: string) {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new BadRequestException(`${key} is required for MoMo payments`);
    }
    return value;
  }
}
