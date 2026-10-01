import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GatewayCode, PaymentGateway } from './payment-gateway.types';

export const PAYMENT_GATEWAYS = Symbol('PAYMENT_GATEWAYS');
export type PaymentDefaultProviderCode = GatewayCode | 'SEPAY';

@Injectable()
export class PaymentGatewayRegistry {
  private readonly map: Map<GatewayCode, PaymentGateway>;
  private readonly defaultCode: PaymentDefaultProviderCode;

  constructor(
    @Inject(PAYMENT_GATEWAYS) gateways: PaymentGateway[],
    config: ConfigService,
  ) {
    this.map = new Map(gateways.map((gateway) => [gateway.code, gateway]));
    const code = config.get<string>('PAYMENT_DEFAULT_PROVIDER', 'MOMO') as PaymentDefaultProviderCode;
    if (code !== 'SEPAY' && !this.map.has(code)) {
      throw new Error(`Invalid PAYMENT_DEFAULT_PROVIDER=${code}`);
    }
    this.defaultCode = code;
  }

  resolve(code: string): PaymentGateway {
    const gateway = this.map.get(code as GatewayCode);
    if (!gateway) {
      throw new BadRequestException(`Unsupported payment provider: ${code}`);
    }
    return gateway;
  }

  getDefault(): PaymentGateway {
    if (this.defaultCode === 'SEPAY') {
      throw new BadRequestException('SEPAY is handled by the legacy checkout flow');
    }
    return this.map.get(this.defaultCode)!;
  }

  getDefaultCode(): PaymentDefaultProviderCode {
    return this.defaultCode;
  }

  has(code: string): boolean {
    return this.map.has(code as GatewayCode);
  }

  withPaymentQuery(): PaymentGateway[] {
    return [...this.map.values()].filter((gateway) => gateway.queryPayment);
  }

  withRefundQuery(): PaymentGateway[] {
    return [...this.map.values()].filter((gateway) => gateway.queryRefund);
  }
}
