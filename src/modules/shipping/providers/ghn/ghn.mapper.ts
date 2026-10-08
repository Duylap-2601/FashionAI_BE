import { Injectable } from '@nestjs/common';
import { ShipmentStatus } from '@prisma/client';
import { ShippingProviderType } from '../../constants/shipping-provider.enum';
import { CreateShipmentInput, CreateShipmentResult, PreviewShippingFeeInput, ShipmentTracking, ShippingFee } from '../../types/shipping.types';

export interface IGhnEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

export interface IGhnFeeData {
  total?: number;
  total_fee?: number;
  service_fee?: number;
  insurance_fee?: number;
  cod_fee?: number;
  fee?: {
    main_service?: number;
    insurance?: number;
    cod_fee?: number;
  };
  expected_delivery_time?: string;
}

export interface IGhnCreateOrderData {
  order_code?: string;
  total_fee?: number;
  expected_delivery_time?: string;
}

export interface IGhnTrackingData {
  status?: string;
  expected_delivery_time?: string;
  updated_date?: string;
  updated_at?: string;
}

@Injectable()
export class GhnMapper {
  mapStatus(status?: string | null): ShipmentStatus {
    switch ((status || '').trim().toLowerCase()) {
      case 'ready_to_pick':
        return ShipmentStatus.READY_TO_PICK;
      case 'picking':
      case 'money_collect_picking':
        return ShipmentStatus.PICKING;
      case 'picked':
        return ShipmentStatus.PICKED;
      case 'transporting':
      case 'sorting':
      case 'storing':
        return ShipmentStatus.IN_TRANSIT;
      case 'delivering':
      case 'money_collect_delivering':
        return ShipmentStatus.DELIVERING;
      case 'delivered':
        return ShipmentStatus.DELIVERED;
      case 'delivery_fail':
      case 'waiting_to_return':
        return ShipmentStatus.DELIVERY_FAILED;
      case 'return_fail':
      case 'exception':
      case 'lost':
      case 'damage':
      case 'scrap':
        return ShipmentStatus.FAILED;
      case 'return':
      case 'return_transporting':
      case 'return_sorting':
      case 'returning':
        return ShipmentStatus.RETURNING;
      case 'returned':
        return ShipmentStatus.RETURNED;
      case 'cancel':
      case 'cancelled':
        return ShipmentStatus.CANCELLED;
      default:
        return ShipmentStatus.UNKNOWN;
    }
  }

  toCreateOrderRequest(input: CreateShipmentInput) {
    return {
      payment_type_id: 1,
      required_note: 'KHONGCHOXEMHANG',
      client_order_code: input.clientOrderCode,
      is_new_from_address: true,
      is_new_to_address: true,
      to_name: input.receiver.name,
      to_phone: input.receiver.phone,
      to_address: input.receiver.address,
      to_ward_name: input.receiver.wardName,
      to_province_name: input.receiver.provinceName,
      service_type_id: this.resolveServiceType(input.weight),
      weight: input.weight,
      length: input.dimensions?.length ?? 25,
      width: input.dimensions?.width ?? 20,
      height: input.dimensions?.height ?? 8,
      insurance_value: input.insuranceValue ?? 0,
      cod_amount: input.codAmount ?? 0,
      note: input.note,
      items: input.items.map((item) => ({
        name: item.name,
        code: item.code,
        quantity: item.quantity,
        price: item.price,
        weight: item.weight ?? Math.max(1, Math.round(input.weight / input.items.length)),
      })),
    };
  }

  toPreviewOrderRequest(input: PreviewShippingFeeInput) {
    return {
      payment_type_id: 1,
      required_note: 'KHONGCHOXEMHANG',
      is_new_from_address: true,
      is_new_to_address: true,
      from_name: input.sender.name ?? 'FashionAI workshop',
      from_phone: input.sender.phone ?? '0900000000',
      from_address: input.sender.address,
      from_ward_name: input.sender.wardName,
      from_province_name: input.sender.provinceName,
      to_name: input.receiver.name ?? 'FashionAI customer',
      to_phone: input.receiver.phone ?? '0900000000',
      to_address: input.receiver.address,
      to_ward_name: input.receiver.wardName,
      to_province_name: input.receiver.provinceName,
      service_type_id: this.resolveServiceType(input.weight),
      weight: input.weight,
      length: input.dimensions?.length ?? 25,
      width: input.dimensions?.width ?? 20,
      height: input.dimensions?.height ?? 8,
      insurance_value: input.insuranceValue ?? 0,
      cod_amount: input.codAmount ?? 0,
      content: input.content ?? 'FashionAI order',
    };
  }

  toPreviewShippingFee(response: IGhnEnvelope<IGhnFeeData>): ShippingFee {
    const data = response.data ?? {};
    return {
      provider: ShippingProviderType.GHN,
      totalFee: Number(data.total_fee ?? data.total ?? 0),
      serviceFee: data.fee?.main_service ?? data.service_fee,
      insuranceFee: data.fee?.insurance ?? data.insurance_fee,
      codFee: data.fee?.cod_fee ?? data.cod_fee,
      expectedDeliveryTime: data.expected_delivery_time ? new Date(data.expected_delivery_time) : undefined,
      raw: response,
    };
  }

  toCreateShipmentResult(response: IGhnEnvelope<IGhnCreateOrderData>): CreateShipmentResult {
    const data = response.data ?? {};
    return {
      provider: ShippingProviderType.GHN,
      providerOrderCode: String(data.order_code ?? ''),
      status: this.mapStatus('ready_to_pick'),
      rawStatus: 'ready_to_pick',
      shippingFee: Number(data.total_fee ?? 0),
      expectedDeliveryTime: data.expected_delivery_time ? new Date(data.expected_delivery_time) : undefined,
      raw: response,
    };
  }

  toTracking(providerOrderCode: string, response: IGhnEnvelope<IGhnTrackingData>): ShipmentTracking {
    const data = response.data ?? {};
    return {
      provider: ShippingProviderType.GHN,
      trackingCode: providerOrderCode,
      status: this.mapStatus(data.status),
      rawStatus: data.status,
      expectedDeliveryTime: data.expected_delivery_time ? new Date(data.expected_delivery_time) : undefined,
      providerEventAt: this.parseDate(data.updated_date ?? data.updated_at),
      raw: response,
    };
  }

  private parseDate(value?: string) {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private resolveServiceType(weight: number) {
    return weight < 20000 ? 2 : 5;
  }
}
