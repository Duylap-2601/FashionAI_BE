import { BadGatewayException, Injectable } from '@nestjs/common';
import { ShippingProviderType } from '../../constants/shipping-provider.enum';
import { IShippingProvider } from '../../interfaces/shipping-provider.interface';
import { CreateShipmentInput, PreviewShippingFeeInput } from '../../types/shipping.types';
import { GhnClient } from './ghn.client';
import { GhnMapper, IGhnCreateOrderData, IGhnEnvelope, IGhnFeeData, IGhnTrackingData } from './ghn.mapper';

@Injectable()
export class GhnShippingProvider implements IShippingProvider {
  readonly provider = ShippingProviderType.GHN;

  constructor(
    private readonly client: GhnClient,
    private readonly mapper: GhnMapper,
  ) {}

  async calculateFee(input: PreviewShippingFeeInput) {
    const response = await this.client.post<IGhnEnvelope<IGhnFeeData>>('/shiip/public-api/v2/shipping-order/preview', this.mapper.toPreviewOrderRequest(input));
    const result = this.mapper.toPreviewShippingFee(response);
    if (!Number.isFinite(result.totalFee) || result.totalFee < 0) {
      throw new BadGatewayException({ code: 'SHIPPING_PROVIDER_UNAVAILABLE', message: 'GHN preview did not return a valid fee' });
    }
    return result;
  }

  async createShipment(input: CreateShipmentInput) {
    const response = await this.client.post<IGhnEnvelope<IGhnCreateOrderData>>('/shiip/public-api/v2/shipping-order/create', this.mapper.toCreateOrderRequest(input));
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
