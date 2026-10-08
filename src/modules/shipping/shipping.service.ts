import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GhnAddressModel, GhnLocationLevel, Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ShippingProviderType } from './constants/shipping-provider.enum';
import { ShippingProviderFactory } from './shipping-provider.factory';
import { GhnShippingProvider } from './providers/ghn/ghn.provider';
import { AdminSettingsService } from '../admin/admin-settings.service';

export interface AddressCatalogLocation {
  id: string;
  name: string;
  aliases: string[];
  catalogRevision: string;
}

@Injectable()
export class ShippingService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly factory: ShippingProviderFactory,
    private readonly ghnProvider: GhnShippingProvider,
    private readonly adminSettingsService: AdminSettingsService,
  ) {}

  async cancelShipment(provider: ShippingProviderType, providerOrderCode: string) {
    return this.factory.get(provider).cancelShipment(providerOrderCode);
  }

  async getTracking(provider: ShippingProviderType, providerOrderCode: string) {
    return this.factory.get(provider).getTracking(providerOrderCode);
  }

  getConfiguredProvider() {
    return ShippingProviderType.GHN;
  }

  async createShipment(
    input: Parameters<ReturnType<ShippingProviderFactory['get']>['createShipment']>[0],
    idempotencyKey?: string,
  ) {
    return this.factory.get(this.getConfiguredProvider()).createShipment(input, idempotencyKey);
  }

  async calculateFee(params: {
    receiver: {
      name?: string;
      phone?: string;
      address: string;
      provinceId: string;
      provinceName: string;
      wardId: string;
      wardName: string;
    };
    weight: number;
    dimensions?: { length: number; width: number; height: number };
    insuranceValue?: number;
    codAmount?: number;
    content?: string;
  }) {
    const pickupSettings = await this.adminSettingsService.getGhnPickupSettings();
    if (!pickupSettings.provinceV3Id || !pickupSettings.wardV3Id || !pickupSettings.provinceName || !pickupSettings.wardName) {
      throw new BadRequestException({ code: 'CAPABILITY_DISABLED', message: 'Vui lòng cấu hình địa chỉ lấy hàng GHN trong Admin trước khi checkout.' });
    }

    const fromAddressLine = pickupSettings.addressLine?.trim() || this.configService.get<string>('GHN_FROM_ADDRESS_LINE')?.trim() || 'FashionAI workshop';
    const fromPhone = this.configService.get<string>('GHN_FROM_PHONE')?.trim() || this.configService.get<string>('SHOP_PHONE')?.trim() || '0900000000';
    const fromName = this.configService.get<string>('GHN_FROM_NAME')?.trim() || 'FashionAI workshop';

    return this.ghnProvider.calculateFee({
      sender: {
        name: fromName,
        phone: fromPhone,
        address: [fromAddressLine, pickupSettings.wardName, pickupSettings.provinceName].filter(Boolean).join(', '),
        provinceId: pickupSettings.provinceV3Id,
        wardId: pickupSettings.wardV3Id,
        provinceName: pickupSettings.provinceName,
        wardName: pickupSettings.wardName,
      },
      receiver: {
        name: params.receiver.name,
        phone: params.receiver.phone,
        address: params.receiver.address,
        provinceId: params.receiver.provinceId,
        wardId: params.receiver.wardId,
        provinceName: params.receiver.provinceName,
        wardName: params.receiver.wardName,
      },
      weight: params.weight,
      dimensions: params.dimensions,
      insuranceValue: params.insuranceValue,
      codAmount: params.codAmount,
      content: params.content,
    });
  }

  async validateGhnLocation(provinceId: string | undefined, wardId: string | undefined) {
    const normalizedProvinceId = provinceId?.trim();
    const normalizedWardId = wardId?.trim();
    if (!normalizedProvinceId || !normalizedWardId) {
      throw new BadRequestException({ code: 'ADDRESS_INVALID', message: 'Vui lòng chọn Tỉnh/Thành và Phường/Xã sau sáp nhập.' });
    }

    const catalog = await this.getPublishedCatalog(GhnAddressModel.POST_MERGER_2_LEVEL);
    const [province, ward] = await Promise.all([
      this.prisma.ghnLocation.findFirst({
        where: { addressModel: GhnAddressModel.POST_MERGER_2_LEVEL, catalogGeneration: catalog.generation, level: GhnLocationLevel.PROVINCE, code: normalizedProvinceId, isActive: true },
      }),
      this.prisma.ghnLocation.findFirst({
        where: { addressModel: GhnAddressModel.POST_MERGER_2_LEVEL, catalogGeneration: catalog.generation, level: GhnLocationLevel.WARD, code: normalizedWardId, parentCode: normalizedProvinceId, isActive: true },
      }),
    ]);

    if (!province) throw new BadRequestException({ code: 'ADDRESS_INVALID', message: 'Tỉnh/Thành sau sáp nhập không hợp lệ.' });
    if (!ward) throw new BadRequestException({ code: 'ADDRESS_INVALID', message: 'Phường/Xã không thuộc Tỉnh/Thành đã chọn.' });
    return {
      ghnAddressModel: GhnAddressModel.POST_MERGER_2_LEVEL,
      ghnProvinceV3Id: province.code,
      ghnWardV3Id: ward.code,
      provinceName: province.name,
      wardName: ward.name,
    };
  }

  async getAddressCatalogProvinces(revision: string) {
    if (!revision) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Thiếu catalog revision.' });
    const catalog = await this.getPublishedCatalog(GhnAddressModel.POST_MERGER_2_LEVEL, revision);
    const rows = await this.prisma.ghnLocation.findMany({
      where: { addressModel: GhnAddressModel.POST_MERGER_2_LEVEL, catalogGeneration: catalog.generation, level: GhnLocationLevel.PROVINCE, isActive: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => this.toAddressCatalogLocation(row, catalog.revision));
  }

  async getAddressCatalogWards(provinceId: string, revision: string) {
    if (!revision) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Thiếu catalog revision.' });
    if (!provinceId?.trim()) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Thiếu provinceId.' });
    const catalog = await this.getPublishedCatalog(GhnAddressModel.POST_MERGER_2_LEVEL, revision);
    const rows = await this.prisma.ghnLocation.findMany({
      where: { addressModel: GhnAddressModel.POST_MERGER_2_LEVEL, catalogGeneration: catalog.generation, level: GhnLocationLevel.WARD, parentCode: provinceId, isActive: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => this.toAddressCatalogLocation(row, catalog.revision));
  }

  async getCapabilities() {
    const catalog = await this.prisma.ghnCatalogMetadata.findUnique({ where: { addressModel: GhnAddressModel.POST_MERGER_2_LEVEL } });
    return {
      capabilityVersion: 'ghn-address-2026-01',
      policyVersion: 'FASHION_SINGLE_PARCEL_V1',
      serverTime: new Date().toISOString(),
      catalogRevision: catalog?.catalogRevision.toString() ?? null,
      catalogEnabled: Boolean(catalog),
      newAddressWriteEnabled: true,
      newAddressCheckoutEnabled: true,
      upgradeRequired: false,
    };
  }

  private async getPublishedCatalog(model: GhnAddressModel, revision?: string) {
    if (revision !== undefined && !/^\d+$/.test(revision)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'catalog revision không hợp lệ.' });
    }

    if (revision !== undefined) {
      const publication = await this.prisma.ghnCatalogPublication.findUnique({
        where: { addressModel_catalogRevision: { addressModel: model, catalogRevision: BigInt(revision) } },
      });
      if (!publication || publication.retainedUntil <= new Date()) {
        throw new ConflictException({ code: 'CATALOG_REVISION_STALE', message: 'Danh mục địa chỉ đã hết hiệu lực.' });
      }
      return { generation: publication.catalogGeneration, revision: publication.catalogRevision };
    }

    const metadata = await this.prisma.ghnCatalogMetadata.findUnique({ where: { addressModel: model } });
    if (!metadata) return { generation: BigInt(1), revision: BigInt(1) };
    return { generation: metadata.publishedGeneration, revision: metadata.catalogRevision };
  }

  private toAddressCatalogLocation(row: { code: string; name: string; aliases: Prisma.JsonValue | null }, revision: bigint): AddressCatalogLocation {
    const aliases = Array.isArray(row.aliases) ? row.aliases.filter((item): item is string => typeof item === 'string') : [];
    return { id: row.code, name: row.name, aliases, catalogRevision: revision.toString() };
  }

  async handleGhnWebhook(payload: Record<string, unknown>, headers: Record<string, unknown>) {
    this.verifyWebhookSecret(headers);

    const providerOrderCode = String(payload.OrderCode ?? payload.order_code ?? payload.orderCode ?? '');
    const eventType = String(payload.Type ?? payload.type ?? 'status');
    const rawStatus = String(payload.Status ?? payload.status ?? '');
    const eventTime = String(payload.Time ?? payload.time ?? payload.UpdatedDate ?? payload.updated_date ?? Date.now());
    const providerEventAt = this.parseProviderEventTime(payload.Time ?? payload.time ?? payload.UpdatedDate ?? payload.updated_date);

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
      providerEventAt,
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
    providerEventAt?: Date;
  }) {
    const { provider, providerOrderCode, shipmentId, shipmentStatus, rawStatus, eventKey, eventType, payload, source, providerEventAt } = params;

    const shipment = await this.prisma.shipment.findFirst({
      where: shipmentId
        ? { id: shipmentId }
        : { provider, providerOrderCode: providerOrderCode! },
      include: { order: true },
    });
    if (!shipment) return { ignored: true };

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

      const incomingProviderEventAt = providerEventAt ?? new Date();
      if (shipment.providerEventAt && providerEventAt && providerEventAt < shipment.providerEventAt) {
        await tx.orderEvent.create({
          data: {
            orderId: shipment.orderId,
            shipmentId: shipment.id,
            type: source === 'STAGING_SIMULATOR' ? 'SHIPMENT_SIMULATED' : source === 'ADMIN_SYNC' ? 'SHIPMENT_SYNCED' : 'SHIPMENT_WEBHOOK',
            source: source === 'STAGING_SIMULATOR' ? 'STAGING' : source === 'ADMIN_SYNC' ? 'ADMIN' : 'SHIPPING',
            fromStatus: shipment.order.status,
            toStatus: shipment.order.status,
            fromShipmentStatus: shipment.status,
            toShipmentStatus: shipment.status,
            publicMessage: 'Đã nhận cập nhật vận chuyển cũ hơn trạng thái hiện tại.',
            internalNote: this.buildShipmentInternalNote(rawStatus, payload),
            deduplicationKey: `${eventKey}:stale`,
            metadata: { rawStatus, providerEventAt: incomingProviderEventAt.toISOString(), stale: true } as Prisma.InputJsonValue,
          },
        });
        return { ignored: true, reason: 'Stale provider event' };
      }

      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          status: shipmentStatus,
          rawStatus: rawStatus ?? shipmentStatus,
          trackingData: payload as Prisma.InputJsonValue,
          providerEventAt: incomingProviderEventAt,
          lastSyncedAt: new Date(),
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: shipment.orderId,
          shipmentId: shipment.id,
          type: source === 'STAGING_SIMULATOR' ? 'SHIPMENT_SIMULATED' : source === 'ADMIN_SYNC' ? 'SHIPMENT_SYNCED' : 'SHIPMENT_WEBHOOK',
          source: source === 'STAGING_SIMULATOR' ? 'STAGING' : source === 'ADMIN_SYNC' ? 'ADMIN' : 'SHIPPING',
          fromStatus: shipment.order.status,
          toStatus: shipment.order.status,
          fromShipmentStatus: shipment.status,
          toShipmentStatus: shipmentStatus,
          publicMessage: this.buildShipmentPublicMessage(shipmentStatus),
          internalNote: this.buildShipmentInternalNote(rawStatus, payload),
          deduplicationKey: eventKey,
          metadata: { rawStatus, providerEventAt: incomingProviderEventAt.toISOString(), source } as Prisma.InputJsonValue,
        },
      });

      return { processed: true, status: shipmentStatus };
    });
  }

  private parseProviderEventTime(value: unknown) {
    if (!value) return new Date();
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private verifyWebhookSecret(headers: Record<string, unknown>) {
    const expected = this.configService.get<string>('GHN_WEBHOOK_SECRET');
    if (!expected) return;
    const provided = headers['x-webhook-secret'] ?? headers['x-ghn-webhook-secret'];
    if (provided !== expected) {
      throw new UnauthorizedException('Invalid GHN webhook secret');
    }
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

  private buildShipmentInternalNote(rawStatus?: string, payload?: Record<string, unknown>) {
    const reason = payload?.Reason ?? payload?.reason;
    const reasonCode = payload?.ReasonCode ?? payload?.reasonCode;
    return [
      rawStatus ? `GHN status: ${rawStatus}` : null,
      reason ? `Reason: ${String(reason)}` : null,
      reasonCode ? `Reason code: ${String(reasonCode)}` : null,
    ].filter(Boolean).join(' | ') || undefined;
  }
}
