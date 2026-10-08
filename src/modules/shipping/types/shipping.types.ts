import { ShipmentStatus } from '@prisma/client';
import { ShippingProviderType } from '../constants/shipping-provider.enum';

export interface IShippingAddress {
  name?: string;
  phone?: string;
  address: string;
  provinceId?: string;
  wardId?: string;
  provinceName?: string;
  wardName?: string;
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

export interface PreviewShippingFeeInput {
  sender: IShippingAddress;
  receiver: IShippingAddress;
  weight: number;
  dimensions?: { length: number; width: number; height: number };
  insuranceValue?: number;
  codAmount?: number;
  content?: string;
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
  rawStatus?: string;
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
