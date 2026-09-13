import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CalculateShippingFeeDto } from './dto/calculate-shipping-fee.dto';
import { ShippingProviderType } from './constants/shipping-provider.enum';
import { ShippingProviderFactory } from './shipping-provider.factory';
import { GhnClient } from './providers/ghn/ghn.client';
import { GhnShippingProvider } from './providers/ghn/ghn.provider';
import { AdminSettingsService } from '../admin/admin-settings.service';

export interface ShippingLocationWard {
  code: string;
  name: string;
}

export interface ShippingLocationDistrict {
  id: number;
  name: string;
  wards: ShippingLocationWard[];
}

export interface ShippingLocationProvince {
  id: number;
  name: string;
  districts: ShippingLocationDistrict[];
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
    private readonly adminSettingsService: AdminSettingsService,
  ) {}

  async calculateFee(dto: CalculateShippingFeeDto) {
    const providerType = this.getConfiguredProvider();

    const pickupSettings = await this.adminSettingsService.getGhnPickupSettings();
    return this.factory.get(providerType).calculateFee({
      from: {
        address: 'FashionAI workshop',
        districtId: pickupSettings.districtId,
        wardCode: pickupSettings.wardCode,
      },
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

  async createShipment(
    input: Parameters<ReturnType<ShippingProviderFactory['get']>['createShipment']>[0],
    idempotencyKey?: string,
  ) {
    const pickupSettings = await this.adminSettingsService.getGhnPickupSettings();
    return this.factory.get(this.getConfiguredProvider()).createShipment(
      {
        ...input,
        sender: {
          ...input.sender,
          districtId: input.sender.districtId ?? pickupSettings.districtId,
          wardCode: input.sender.wardCode ?? pickupSettings.wardCode,
        },
      },
      idempotencyKey,
    );
  }

  async cancelShipment(provider: ShippingProviderType, providerOrderCode: string) {
    return this.factory.get(provider).cancelShipment(providerOrderCode);
  }

  async getTracking(provider: ShippingProviderType, providerOrderCode: string) {
    return this.factory.get(provider).getTracking(providerOrderCode);
  }

  getConfiguredProvider() {
    return ShippingProviderType.GHN;
  }

  async getProvinces() {
    const response = await this.ghnClient.post<{ data?: unknown[] }>('/shiip/public-api/master-data/province', {});
    return (response.data ?? [])
      .map((item) => this.normalizeLegacyLocation(item, 'ProvinceID', 'ProvinceName'))
      .filter((item): item is { id: number; name: string } => Boolean(item));
  }

  async getDistricts(provinceId: number) {
    const response = await this.ghnClient.post<{ data?: unknown[] }>('/shiip/public-api/master-data/district', { province_id: provinceId });
    return (response.data ?? [])
      .map((item) => this.normalizeLegacyLocation(item, 'DistrictID', 'DistrictName'))
      .filter((item): item is { id: number; name: string } => Boolean(item));
  }

  async getWards(districtId: number) {
    const response = await this.ghnClient.post<{ data?: unknown[] }>('/shiip/public-api/master-data/ward', { district_id: districtId });
    return (response.data ?? [])
      .map((item) => this.normalizeLegacyWard(item))
      .filter((item): item is { code: string; name: string } => Boolean(item));
  }

  private normalizeLegacyLocation(value: unknown, idKey: string, nameKey: string) {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const id = Number(record[idKey]);
    const name = record[nameKey];
    return Number.isFinite(id) && id > 0 && typeof name === 'string' && name.trim()
      ? { id, name: name.trim() }
      : null;
  }

  private normalizeLegacyWard(value: unknown) {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const code = record.WardCode;
    const name = record.WardName;
    return typeof code === 'string' && code.trim() && typeof name === 'string' && name.trim()
      ? { code: code.trim(), name: name.trim() }
      : null;
  }

  async getLocations() {
    const now = Date.now();
    if (this.locationsCache && this.locationsCache.expiresAt > now) {
      return this.locationsCache.data;
    }

    const provinces = await this.getProvinces();
    const data = await Promise.all(
      provinces.map(async (province) => {
        const districts = await this.getDistricts(province.id);
        const districtsWithWards = await Promise.all(
          districts.map(async (district) => ({
            ...district,
            wards: await this.getWards(district.id),
          })),
        );

        return {
          ...province,
          districts: districtsWithWards,
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

    return this.handleShippingStatus({
      provider: ShippingProviderType.GHN,
      providerOrderCode,
      shipmentStatus,
      rawStatus,
      eventKey,
      eventType,
      payload,
    });
  }

  /**
   * Handle shipment status update from any source (webhook, staging simulator, reconciliation).
   * This is the single handler that both production webhooks and staging simulator use.
   */
  async handleShippingStatus(params: {
    provider: ShippingProviderType;
    providerOrderCode?: string;
    shipmentId?: string;
    shipmentStatus: ShipmentStatus;
    rawStatus?: string;
    eventKey: string;
    eventType?: string;
    payload?: Record<string, unknown>;
    source?: string;
  }) {
    const { provider, providerOrderCode, shipmentId, shipmentStatus, rawStatus, eventKey, eventType, payload, source } = params;

    const shipment = await this.prisma.shipment.findFirst({
      where: shipmentId
        ? { id: shipmentId }
        : { provider, providerOrderCode: providerOrderCode! },
      include: { order: true },
    });
    if (!shipment) return { ignored: true };

    // Transition guard: never regress terminal states
    const terminalStatuses: ShipmentStatus[] = [
      ShipmentStatus.DELIVERED,
      ShipmentStatus.RETURNED,
      ShipmentStatus.CANCELLED,
    ];
    if (terminalStatuses.includes(shipment.status)) {
      return { ignored: true, reason: `Shipment already in terminal status ${shipment.status}` };
    }

    return this.prisma.$transaction(async (tx) => {
      try {
        await tx.webhookEvent.create({
          data: {
            provider,
            eventKey,
            providerOrderCode: providerOrderCode ?? shipment.providerOrderCode,
            eventType: eventType ?? 'status',
            payload: payload as Prisma.InputJsonValue,
            signatureValid: source === 'STAGING_SIMULATOR' ? true : undefined,
            shipmentId: shipment.id,
            orderId: shipment.orderId,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return { ignored: true };
        }
        throw error;
      }

      const nextOrderStatus = this.mapShipmentToOrderStatus(shipmentStatus, shipment.order.status);
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          status: shipmentStatus,
          rawStatus: rawStatus ?? shipmentStatus,
          trackingData: payload as Prisma.InputJsonValue,
          providerEventAt: new Date(),
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
          type: source === 'STAGING_SIMULATOR' ? 'SHIPMENT_SIMULATED' : 'SHIPMENT_WEBHOOK',
          source: source === 'STAGING_SIMULATOR' ? 'STAGING' : 'SHIPPING',
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
    // Terminal order states should not be changed by delayed webhooks
    const terminalOrderStatuses: OrderStatus[] = [
      OrderStatus.CANCELLED,
      OrderStatus.RETURNED,
      OrderStatus.EXPIRED,
    ];
    if (terminalOrderStatuses.includes(current)) {
      return current;
    }

    if (status === ShipmentStatus.DELIVERED) return OrderStatus.DELIVERED;

    const processingStatuses: ShipmentStatus[] = [
      ShipmentStatus.READY_TO_PICK,
      ShipmentStatus.CREATED,
      ShipmentStatus.PICKING,
    ];
    if (processingStatuses.includes(status)) {
      return OrderStatus.SHIPPING;
    }

    const inTransitStatuses: ShipmentStatus[] = [
      ShipmentStatus.PICKED,
      ShipmentStatus.SHIPPING,
      ShipmentStatus.IN_TRANSIT,
      ShipmentStatus.DELIVERING,
    ];
    if (inTransitStatuses.includes(status)) {
      return OrderStatus.SHIPPING;
    }

    if (status === ShipmentStatus.DELIVERY_FAILED) return current;
    if (status === ShipmentStatus.RETURNING) return OrderStatus.RETURNED;
    if (status === ShipmentStatus.RETURNED) return OrderStatus.RETURNED;
    if (status === ShipmentStatus.CANCELLED) return current;

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
