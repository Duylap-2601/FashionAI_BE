import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GhnAddressModel, GhnLocationLevel, Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { CalculateShippingFeeDto } from './dto/calculate-shipping-fee.dto';
import { ShippingProviderType } from './constants/shipping-provider.enum';
import { ShippingProviderFactory } from './shipping-provider.factory';
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

export interface AddressCatalogLocation {
  id: string;
  name: string;
  aliases: string[];
  catalogRevision: string;
}

@Injectable()
export class ShippingService {
  private locationsCache: { expiresAt: number; revision: string; data: ShippingLocationProvince[] } | null = null;
  private readonly LOCATIONS_CACHE_TTL_SECONDS = 24 * 60 * 60;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly factory: ShippingProviderFactory,
    private readonly ghnProvider: GhnShippingProvider,
    private readonly adminSettingsService: AdminSettingsService,
    private readonly redisService: RedisService,
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
          districtId: input.sender.addressModel === GhnAddressModel.POST_MERGER_2_LEVEL ? input.sender.districtId : input.sender.districtId ?? pickupSettings.districtId,
          wardCode: input.sender.addressModel === GhnAddressModel.POST_MERGER_2_LEVEL ? input.sender.wardCode : input.sender.wardCode ?? pickupSettings.wardCode,
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
    const catalog = await this.getPublishedCatalog(GhnAddressModel.LEGACY_3_LEVEL);
    const cached = await this.getCachedJson<{ id: number; name: string }[]>(this.locationsCacheKey('legacy-provinces', catalog.revision.toString()));
    if (cached) return cached;

    const provinces = await this.prisma.ghnLocation.findMany({
      where: { addressModel: GhnAddressModel.LEGACY_3_LEVEL, catalogGeneration: catalog.generation, level: GhnLocationLevel.PROVINCE, isActive: true },
      orderBy: { name: 'asc' },
    });
    const result = provinces.map((item) => ({ id: Number(item.code), name: item.name })).filter((item) => Number.isFinite(item.id));
    await this.setCachedJson(this.locationsCacheKey('legacy-provinces', catalog.revision.toString()), result);
    return result;
  }

  async calculatePostMergerFee(params: {
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
    if (pickupSettings.addressModel !== GhnAddressModel.POST_MERGER_2_LEVEL || !pickupSettings.provinceV3Id || !pickupSettings.wardV3Id || !pickupSettings.provinceName || !pickupSettings.wardName) {
      throw new BadRequestException({ code: 'CAPABILITY_DISABLED', message: 'Vui lòng cấu hình địa chỉ lấy hàng GHN sau sáp nhập trong Admin trước khi checkout.' });
    }

    const fromAddressLine = this.configService.get<string>('GHN_FROM_ADDRESS_LINE')?.trim() || 'FashionAI workshop';
    const fromPhone = this.configService.get<string>('GHN_FROM_PHONE')?.trim() || this.configService.get<string>('SHOP_PHONE')?.trim() || '0900000000';
    const fromName = this.configService.get<string>('GHN_FROM_NAME')?.trim() || 'FashionAI workshop';

    return this.ghnProvider.previewFee({
      sender: {
        addressModel: GhnAddressModel.POST_MERGER_2_LEVEL,
        name: fromName,
        phone: fromPhone,
        address: [fromAddressLine, pickupSettings.wardName, pickupSettings.provinceName].filter(Boolean).join(', '),
        provinceId: pickupSettings.provinceV3Id,
        wardId: pickupSettings.wardV3Id,
        provinceName: pickupSettings.provinceName,
        wardName: pickupSettings.wardName,
      },
      receiver: {
        addressModel: GhnAddressModel.POST_MERGER_2_LEVEL,
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

  async getDistricts(provinceId: number) {
    const catalog = await this.getPublishedCatalog(GhnAddressModel.LEGACY_3_LEVEL);
    const cacheKey = this.locationsCacheKey('legacy-districts', `${catalog.revision}:${provinceId}`);
    const cached = await this.getCachedJson<{ id: number; name: string }[]>(cacheKey);
    if (cached) return cached;

    const districts = await this.prisma.ghnLocation.findMany({
      where: { addressModel: GhnAddressModel.LEGACY_3_LEVEL, catalogGeneration: catalog.generation, level: GhnLocationLevel.DISTRICT, parentCode: String(provinceId), isActive: true },
      orderBy: { name: 'asc' },
    });
    const result = districts.map((item) => ({ id: Number(item.code), name: item.name })).filter((item) => Number.isFinite(item.id));
    await this.setCachedJson(cacheKey, result);
    return result;
  }

  async getWards(districtId: number) {
    const catalog = await this.getPublishedCatalog(GhnAddressModel.LEGACY_3_LEVEL);
    const cacheKey = this.locationsCacheKey('legacy-wards', `${catalog.revision}:${districtId}`);
    const cached = await this.getCachedJson<{ code: string; name: string }[]>(cacheKey);
    if (cached) return cached;

    const wards = await this.prisma.ghnLocation.findMany({
      where: { addressModel: GhnAddressModel.LEGACY_3_LEVEL, catalogGeneration: catalog.generation, level: GhnLocationLevel.WARD, parentCode: String(districtId), isActive: true },
      orderBy: { name: 'asc' },
    });
    const result = wards.map((item) => ({ code: item.code, name: item.name }));
    await this.setCachedJson(cacheKey, result);
    return result;
  }

  private locationsCacheKey(scope: string, parentId?: number | string) {
    return parentId === undefined ? `ghn:locations:${scope}` : `ghn:locations:${scope}:${parentId}`;
  }

  private async getCachedJson<T>(key: string): Promise<T | null> {
    const raw = await this.redisService.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async setCachedJson(key: string, value: unknown) {
    await this.redisService.set(key, JSON.stringify(value), this.LOCATIONS_CACHE_TTL_SECONDS);
  }

  async validateGhnLocation(provinceId: number, districtId: number, wardCode: string) {
    const catalog = await this.getPublishedCatalog(GhnAddressModel.LEGACY_3_LEVEL);
    const [province, district, ward] = await Promise.all([
      this.prisma.ghnLocation.findFirst({ where: { addressModel: GhnAddressModel.LEGACY_3_LEVEL, catalogGeneration: catalog.generation, level: GhnLocationLevel.PROVINCE, code: String(provinceId), isActive: true } }),
      this.prisma.ghnLocation.findFirst({ where: { addressModel: GhnAddressModel.LEGACY_3_LEVEL, catalogGeneration: catalog.generation, level: GhnLocationLevel.DISTRICT, code: String(districtId), parentCode: String(provinceId), isActive: true } }),
      this.prisma.ghnLocation.findFirst({ where: { addressModel: GhnAddressModel.LEGACY_3_LEVEL, catalogGeneration: catalog.generation, level: GhnLocationLevel.WARD, code: wardCode, parentCode: String(districtId), isActive: true } }),
    ]);
    if (!province) throw new BadRequestException({ code: 'ADDRESS_INVALID', message: 'Tỉnh/Thành không hợp lệ.' });
    if (!district) throw new BadRequestException({ code: 'ADDRESS_INVALID', message: 'Quận/Huyện không thuộc Tỉnh/Thành đã chọn.' });
    if (!ward) throw new BadRequestException({ code: 'ADDRESS_INVALID', message: 'Phường/Xã không thuộc Quận/Huyện đã chọn.' });
    return {
      ghnAddressModel: GhnAddressModel.LEGACY_3_LEVEL,
      ghnProvinceId: Number(province.code),
      ghnDistrictId: Number(district.code),
      ghnWardCode: ward.code,
      provinceName: province.name,
      districtName: district.name,
      wardName: ward.name,
    };
  }

  async validateGhnPostMergerLocation(provinceId: string | undefined, wardId: string | undefined) {
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

  async getLocations() {
    const now = Date.now();
    const catalog = await this.getPublishedCatalog(GhnAddressModel.LEGACY_3_LEVEL);
    const revision = catalog.revision.toString();
    if (this.locationsCache && this.locationsCache.revision === revision && this.locationsCache.expiresAt > now) {
      return this.locationsCache.data;
    }

    const where = { addressModel: GhnAddressModel.LEGACY_3_LEVEL, catalogGeneration: catalog.generation, isActive: true };
    const [provinceRows, districtRows, wardRows] = await Promise.all([
      this.prisma.ghnLocation.findMany({ where: { ...where, level: GhnLocationLevel.PROVINCE }, orderBy: { name: 'asc' } }),
      this.prisma.ghnLocation.findMany({ where: { ...where, level: GhnLocationLevel.DISTRICT }, orderBy: { name: 'asc' } }),
      this.prisma.ghnLocation.findMany({ where: { ...where, level: GhnLocationLevel.WARD }, orderBy: { name: 'asc' } }),
    ]);

    const wardsByDistrict = new Map<string, ShippingLocationWard[]>();
    for (const ward of wardRows) {
      if (!ward.parentCode) continue;
      const list = wardsByDistrict.get(ward.parentCode) ?? [];
      list.push({ code: ward.code, name: ward.name });
      wardsByDistrict.set(ward.parentCode, list);
    }

    const districtsByProvince = new Map<string, ShippingLocationDistrict[]>();
    for (const district of districtRows) {
      if (!district.parentCode) continue;
      const districtId = Number(district.code);
      if (!Number.isFinite(districtId)) continue;
      const list = districtsByProvince.get(district.parentCode) ?? [];
      list.push({ id: districtId, name: district.name, wards: wardsByDistrict.get(district.code) ?? [] });
      districtsByProvince.set(district.parentCode, list);
    }

    const data = provinceRows
      .map((province) => {
        const provinceId = Number(province.code);
        if (!Number.isFinite(provinceId)) return null;
        return {
          id: provinceId,
          name: province.name,
          districts: districtsByProvince.get(province.code) ?? [],
        };
      })
      .filter((item): item is ShippingLocationProvince => item !== null);

    this.locationsCache = {
      expiresAt: now + this.LOCATIONS_CACHE_TTL_SECONDS * 1000,
      revision,
      data,
    };

    return data;
  }

  async getAddressCatalogProvinces(model: GhnAddressModel, revision: string) {
    if (!revision) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Thiếu catalog revision.' });
    const catalog = await this.getPublishedCatalog(model, revision);
    const rows = await this.prisma.ghnLocation.findMany({
      where: { addressModel: model, catalogGeneration: catalog.generation, level: GhnLocationLevel.PROVINCE, isActive: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => this.toAddressCatalogLocation(row, catalog.revision));
  }

  async getAddressCatalogWards(model: GhnAddressModel, provinceId: string, revision: string) {
    if (!revision) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Thiếu catalog revision.' });
    if (!provinceId?.trim()) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Thiếu provinceId.' });
    const catalog = await this.getPublishedCatalog(model, revision);
    const rows = await this.prisma.ghnLocation.findMany({
      where: { addressModel: model, catalogGeneration: catalog.generation, level: GhnLocationLevel.WARD, parentCode: provinceId, isActive: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => this.toAddressCatalogLocation(row, catalog.revision));
  }

  async getCapabilities() {
    const postMergerCatalog = await this.prisma.ghnCatalogMetadata.findUnique({ where: { addressModel: GhnAddressModel.POST_MERGER_2_LEVEL } });
    return {
      capabilityVersion: 'ghn-address-2026-01',
      policyVersion: 'FASHION_SINGLE_PARCEL_V1',
      serverTime: new Date().toISOString(),
      catalogRevision: postMergerCatalog?.catalogRevision.toString() ?? null,
      catalogEnabled: Boolean(postMergerCatalog),
      newAddressWriteEnabled: false,
      newAddressCheckoutEnabled: false,
      legacyCheckoutAllowed: true,
      upgradeRequired: false,
    };
  }

  parseAddressModel(value: string | undefined): GhnAddressModel {
    if (value === GhnAddressModel.POST_MERGER_2_LEVEL) return GhnAddressModel.POST_MERGER_2_LEVEL;
    if (!value || value === GhnAddressModel.LEGACY_3_LEVEL) return GhnAddressModel.LEGACY_3_LEVEL;
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Mô hình địa chỉ không hợp lệ.' });
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
