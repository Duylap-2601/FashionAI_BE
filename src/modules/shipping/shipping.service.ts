import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CalculateShippingFeeDto } from './dto/calculate-shipping-fee.dto';
import { ShippingProviderType } from './constants/shipping-provider.enum';
import { ShippingProviderFactory } from './shipping-provider.factory';
import { GhnClient } from './providers/ghn/ghn.client';
import { GhnShippingProvider } from './providers/ghn/ghn.provider';

interface GhnMasterLocation {
  _id: number;
  name: string;
  status: number;
}

interface GhnMasterDataResponse {
  data: GhnMasterLocation[] | null;
}

export interface ShippingLocationWard {
  id: number;
  name: string;
}

export interface ShippingLocationProvince {
  id: number;
  name: string;
  wards: ShippingLocationWard[];
}

@Injectable()
export class ShippingService {
  private locationsCache: { expiresAt: number; data: ShippingLocationProvince[] } | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly factory: ShippingProviderFactory,
    private readonly ghnClient: GhnClient,
    private readonly ghnProvider: GhnShippingProvider,
  ) {}

  calculateFee(dto: CalculateShippingFeeDto) {
    return this.factory.get(ShippingProviderType.GHN).calculateFee({
      from: { address: 'FashionAI workshop' },
      to: {
        address: '',
        districtId: dto.toDistrictId,
        wardCode: dto.toWardCode,
      },
      weight: dto.weight,
      dimensions: dto.length && dto.width && dto.height
        ? { length: dto.length, width: dto.width, height: dto.height }
        : undefined,
      insuranceValue: dto.insuranceValue,
      codAmount: dto.codAmount,
    });
  }

  async createShipment(input: Parameters<ReturnType<ShippingProviderFactory['get']>['createShipment']>[0]) {
    return this.factory.get(input.sender ? ShippingProviderType.GHN : ShippingProviderType.GHN).createShipment(input);
  }

  async cancelShipment(provider: ShippingProviderType, providerOrderCode: string) {
    return this.factory.get(provider).cancelShipment(providerOrderCode);
  }

  async getTracking(provider: ShippingProviderType, providerOrderCode: string) {
    return this.factory.get(provider).getTracking(providerOrderCode);
  }

  async getProvinces() {
    const response = await this.ghnClient.post<{ data?: unknown[] }>('/shiip/public-api/master-data/province', {});
    return response.data ?? [];
  }

  async getDistricts(provinceId: number) {
    const response = await this.ghnClient.post<{ data?: unknown[] }>('/shiip/public-api/master-data/district', { province_id: provinceId });
    return response.data ?? [];
  }

  async getWards(districtId: number) {
    const response = await this.ghnClient.post<{ data?: unknown[] }>('/shiip/public-api/master-data/ward', { district_id: districtId });
    return response.data ?? [];
  }

  async getLocations() {
    const now = Date.now();
    if (this.locationsCache && this.locationsCache.expiresAt > now) {
      return this.locationsCache.data;
    }

    const provinceResponse = await this.ghnClient.get<GhnMasterDataResponse>(
      '/shiip/public-api/v3/master-data/province/all',
      { offset: 0, limit: 200 },
    );

    const provinces = (provinceResponse.data || [])
      .filter((item) => item.status === 1)
      .map((item) => ({ id: item._id, name: item.name }));

    const data = await Promise.all(
      provinces.map(async (province) => {
        const wardResponse = await this.ghnClient.get<GhnMasterDataResponse>(
          '/shiip/public-api/v3/master-data/ward/all-by-province-id',
          { province_id: province.id, offset: 0, limit: 200 },
        );

        return {
          ...province,
          wards: (wardResponse.data || [])
            .filter((item) => item.status === 1)
            .map((item) => ({ id: item._id, name: item.name })),
        };
      }),
    );

    this.locationsCache = {
      expiresAt: now + 24 * 60 * 60 * 1000,
      data,
    };

    return data;
  }

  async handleGhnWebhook(payload: Record<string, unknown>, headers: Record<string, unknown>) {
    this.verifyWebhookSecret(headers);

    const providerOrderCode = String(payload.OrderCode ?? payload.order_code ?? payload.orderCode ?? '');
    const eventType = String(payload.Type ?? payload.type ?? 'status');
    const rawStatus = String(payload.Status ?? payload.status ?? '');
    const eventTime = String(payload.Time ?? payload.time ?? payload.UpdatedDate ?? payload.updated_date ?? Date.now());

    if (!providerOrderCode) {
      throw new NotFoundException('Missing GHN order code');
    }

    const eventKey = `GHN:${providerOrderCode}:${eventType}:${eventTime}`;
    const shipmentStatus = this.ghnProvider.mapWebhookStatus(rawStatus);

    return this.prisma.$transaction(async (tx) => {
      try {
        await tx.webhookEvent.create({
          data: {
            provider: ShippingProviderType.GHN,
            eventKey,
            providerOrderCode,
            eventType,
            payload: payload as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return { ignored: true };
        }
        throw error;
      }

      const shipment = await tx.shipment.findFirst({
        where: { provider: ShippingProviderType.GHN, providerOrderCode },
        include: { order: true },
      });
      if (!shipment) return { ignored: true };

      const nextOrderStatus = this.mapShipmentToOrderStatus(shipmentStatus, shipment.order.status);
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          status: shipmentStatus,
          trackingData: payload as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
        },
      });

      if (nextOrderStatus && nextOrderStatus !== shipment.order.status) {
        await tx.order.update({ where: { id: shipment.orderId }, data: { status: nextOrderStatus } });
      }

      await tx.orderEvent.create({
        data: {
          orderId: shipment.orderId,
          shipmentId: shipment.id,
          type: 'SHIPMENT_WEBHOOK',
          source: 'SHIPPING',
          fromStatus: shipment.order.status,
          toStatus: nextOrderStatus,
          publicMessage: this.buildShipmentPublicMessage(shipmentStatus),
          deduplicationKey: eventKey,
        },
      });

      return { processed: true, status: shipmentStatus };
    });
  }

  private verifyWebhookSecret(headers: Record<string, unknown>) {
    const expected = this.configService.get<string>('GHN_WEBHOOK_SECRET');
    if (!expected) return;
    const provided = headers['x-webhook-secret'] ?? headers['x-ghn-webhook-secret'];
    if (provided !== expected) {
      throw new UnauthorizedException('Invalid GHN webhook secret');
    }
  }

  private mapShipmentToOrderStatus(status: ShipmentStatus, current: OrderStatus) {
    if (status === ShipmentStatus.DELIVERED) return OrderStatus.DELIVERED;
    const shippingStatuses: ShipmentStatus[] = [
      ShipmentStatus.CREATED,
      ShipmentStatus.PICKING,
      ShipmentStatus.PICKED,
      ShipmentStatus.IN_TRANSIT,
      ShipmentStatus.DELIVERING,
    ];
    if (shippingStatuses.includes(status)) {
      return OrderStatus.SHIPPING;
    }
    if (status === ShipmentStatus.RETURNED) return OrderStatus.RETURNED;
    return current;
  }

  private buildShipmentPublicMessage(status: ShipmentStatus) {
    switch (status) {
      case ShipmentStatus.DELIVERED:
        return 'Đơn vị vận chuyển xác nhận đã giao hàng thành công.';
      case ShipmentStatus.PICKED:
      case ShipmentStatus.IN_TRANSIT:
      case ShipmentStatus.DELIVERING:
        return 'Đơn hàng đang được đơn vị vận chuyển xử lý.';
      case ShipmentStatus.DELIVERY_FAILED:
        return 'Đơn vị vận chuyển giao hàng chưa thành công.';
      case ShipmentStatus.RETURNING:
      case ShipmentStatus.RETURNED:
        return 'Đơn hàng đang trong quy trình hoàn hàng.';
      case ShipmentStatus.CANCELLED:
        return 'Vận đơn đã được hủy.';
      default:
        return 'Trạng thái vận chuyển đã được cập nhật.';
    }
  }
}
