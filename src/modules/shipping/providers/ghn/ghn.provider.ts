import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShippingProviderType } from '../../constants/shipping-provider.enum';
import { IShippingProvider } from '../../interfaces/shipping-provider.interface';
import { CalculateShippingFeeInput, CreateShipmentInput } from '../../types/shipping.types';
import { getGhnConfig } from './ghn.config';
import { GhnClient } from './ghn.client';
import { GhnMapper, IGhnCreateOrderData, IGhnEnvelope, IGhnFeeData, IGhnTrackingData } from './ghn.mapper';

@Injectable()
export class GhnShippingProvider implements IShippingProvider {
  readonly provider = ShippingProviderType.GHN;

  constructor(
    private readonly client: GhnClient,
    private readonly mapper: GhnMapper,
    private readonly configService: ConfigService,
  ) {}

  async calculateFee(input: CalculateShippingFeeInput) {
    const config = getGhnConfig(this.configService);
    const response = await this.client.post<IGhnEnvelope<IGhnFeeData>>('/shiip/public-api/v2/shipping-order/fee', this.mapper.toFeeRequest(input, config.fromDistrictId, config.fromWardCode));
    return this.mapper.toShippingFee(response);
  }

  async createShipment(input: CreateShipmentInput) {
    const config = getGhnConfig(this.configService);
    const response = await this.client.post<IGhnEnvelope<IGhnCreateOrderData>>('/shiip/public-api/v2/shipping-order/create', this.mapper.toCreateOrderRequest(input, config.fromDistrictId, config.fromWardCode));
    const result = this.mapper.toCreateShipmentResult(response);
    if (!result.providerOrderCode) {
      throw new BadGatewayException('GHN did not return order_code');
    }
    return result;
  }

  async cancelShipment(providerOrderCode: string) {
    await this.client.post('/shiip/public-api/v2/switch-status/cancel', { order_codes: [providerOrderCode] });
  }

  async getTracking(providerOrderCode: string) {
    const response = await this.client.get<IGhnEnvelope<IGhnTrackingData>>('/shiip/public-api/v2/shipping-order/detail', { order_code: providerOrderCode });
    return this.mapper.toTracking(providerOrderCode, response);
  }

  mapWebhookStatus(status?: string | null) {
    return this.mapper.mapStatus(status);
  }
}
