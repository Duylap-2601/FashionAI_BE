import { ShipmentStatus } from '@prisma/client';
import { ShippingProviderType } from '../constants/shipping-provider.enum';

export interface IShippingAddress {
  name?: string;
  phone?: string;
  address: string;
  provinceName?: string;
  districtName?: string;
  wardName?: string;
  districtId?: number;
  wardCode?: string;
}

export interface CalculateShippingFeeInput {
  from: IShippingAddress;
  to: IShippingAddress;
  weight: number;
  dimensions?: { length: number; width: number; height: number };
  insuranceValue?: number;
  codAmount?: number;
}

export interface ShippingFee {
  provider: ShippingProviderType;
  totalFee: number;
  serviceFee?: number;
  insuranceFee?: number;
  codFee?: number;
  expectedDeliveryTime?: Date;
  raw?: unknown;
}

export interface CreateShipmentInput {
  orderId: string;
  clientOrderCode: string;
  sender: IShippingAddress;
  receiver: IShippingAddress;
  items: {
    name: string;
    code?: string;
    quantity: number;
    price: number;
    weight?: number;
  }[];
  weight: number;
  dimensions?: { length: number; width: number; height: number };
  codAmount?: number;
  insuranceValue?: number;
  note?: string;
}

export interface CreateShipmentResult {
  provider: ShippingProviderType;
  providerOrderCode: string;
  status: ShipmentStatus;
  shippingFee: number;
  expectedDeliveryTime?: Date;
  raw?: unknown;
}

export interface ShipmentTracking {
  provider: ShippingProviderType;
  trackingCode: string;
  status: ShipmentStatus;
  rawStatus?: string;
  expectedDeliveryTime?: Date;
  providerEventAt?: Date;
  raw?: unknown;
}
