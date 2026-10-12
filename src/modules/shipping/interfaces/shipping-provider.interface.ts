import { ShippingProviderType } from '../constants/shipping-provider.enum';
import {
  CreateShipmentInput,
  CreateShipmentResult,
  PreviewShippingFeeInput,
  ShipmentTracking,
  ShippingFee,
} from '../types/shipping.types';

export interface IShippingProvider {
  calculateFee(input: PreviewShippingFeeInput): Promise<ShippingFee>;
  createShipment(input: CreateShipmentInput, idempotencyKey?: string): Promise<CreateShipmentResult>;
  cancelShipment(providerOrderCode: string, idempotencyKey?: string): Promise<void>;
  getTracking(providerOrderCode: string): Promise<ShipmentTracking>;
  readonly provider: ShippingProviderType;
}
