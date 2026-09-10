import { ShippingProviderType } from '../constants/shipping-provider.enum';
import {
  CalculateShippingFeeInput,
  CreateShipmentInput,
  CreateShipmentResult,
  ShipmentTracking,
  ShippingFee,
} from '../types/shipping.types';

export interface IShippingProvider {
  calculateFee(input: CalculateShippingFeeInput): Promise<ShippingFee>;
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
  cancelShipment(providerOrderCode: string): Promise<void>;
  getTracking(providerOrderCode: string): Promise<ShipmentTracking>;
  readonly provider: ShippingProviderType;
}
