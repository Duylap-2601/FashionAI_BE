import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Shipment, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { ShippingService } from './shipping.service';
import { ShippingProviderType } from './constants/shipping-provider.enum';
import { shipmentInsuranceValueVnd } from './utils/shipment-insurance.util';

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

// Tự đồng bộ trạng thái vận đơn với GHN, dự phòng khi webhook không tới.
const STATUS_SYNC_LOCK_KEY = 'shipment-status-sync';
const STATUS_SYNC_LOCK_TTL_SECONDS = 240;
const STATUS_SYNC_BATCH_SIZE = 25;
const STATUS_SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;
const STATUS_SYNC_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const STATUS_SYNC_ACTIVE_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.UNKNOWN,
  ShipmentStatus.READY_TO_PICK,
  ShipmentStatus.CREATED,
  ShipmentStatus.PICKING,
  ShipmentStatus.PICKED,
  ShipmentStatus.SHIPPING,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.DELIVERING,
  ShipmentStatus.DELIVERY_FAILED,
  ShipmentStatus.RETURNING,
];

@Injectable()
export class ShipmentService {
  private readonly logger = new Logger(ShipmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shippingService: ShippingService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Create shipment from order. Called by outbox processor after order is CONFIRMED.
   * Does NOT run inside the same transaction as the order state change.
   */
  async createShipmentFromOrder(order: OrderWithItems) {
    const provider = this.shippingService.getConfiguredProvider();
    const shippingInfo = this.buildShippingInfo(order);
    this.assertShipmentAddress(shippingInfo);
    const shipmentInput = this.buildShipmentInput(order, shippingInfo);

    const requestKey = `order:${order.id}:shipment:${Date.now()}`;

    const pendingShipment = await this.prisma.shipment.create({
      data: {
        orderId: order.id,
        provider,
        requestKey,
        status: ShipmentStatus.PENDING,
        shippingFee: order.shippingFee,
        shippingFeeVnd: order.shippingFeeVnd,
        quotedShippingFee: order.shippingFee,
        lastSyncedAt: new Date(),
      },
    });

    try {
      const result = await this.shippingService.createShipment(shipmentInput, requestKey);

      const shipment = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.shipment.update({
          where: { id: pendingShipment.id },
          data: {
            status: this.mapProviderStatus(result.status),
            rawStatus: result.rawStatus ?? 'ready_to_pick',
            providerOrderCode: result.providerOrderCode,
            shippingFee: new Prisma.Decimal(result.shippingFee),
            shippingFeeVnd: BigInt(Math.round(result.shippingFee)),
            actualShippingFee: new Prisma.Decimal(result.shippingFee),
            expectedDeliveryTime: result.expectedDeliveryTime,
            trackingData: result.raw as Prisma.InputJsonValue,
            lastSyncedAt: new Date(),
          },
        });

        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            shipmentId: updated.id,
            type: 'SHIPMENT_CREATED',
            source: 'SYSTEM',
            fromStatus: order.status,
            toStatus: order.status,
            publicMessage: 'Vận đơn đã được tạo và đang chờ đơn vị vận chuyển xử lý.',
            deduplicationKey: `shipment:${requestKey}:created`,
          },
        });

        return updated;
      });

      this.logger.log(`Shipment created for order ${order.id}: ${result.providerOrderCode}`);
      return shipment;
    } catch (error) {
      await this.prisma.shipment.update({
        where: { id: pendingShipment.id },
        data: { status: ShipmentStatus.FAILED, lastSyncedAt: new Date() },
      }).catch(() => undefined);

      this.logger.error(`Failed to create shipment for order ${order.id}`, error);
      throw error;
    }
  }

  async cancelShipmentById(shipmentId: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { order: true },
    });
    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} not found`);

    const terminalStatuses: ShipmentStatus[] = [ShipmentStatus.DELIVERED, ShipmentStatus.RETURNED, ShipmentStatus.CANCELLED];
    if (terminalStatuses.includes(shipment.status)) {
      this.logger.warn(`Shipment ${shipmentId} already in terminal status ${shipment.status}`);
      return shipment;
    }

    if (shipment.providerOrderCode) {
      try {
        await this.shippingService.cancelShipment(
          shipment.provider as ShippingProviderType,
          shipment.providerOrderCode,
        );
      } catch (error) {
        this.logger.error(`Failed to cancel provider shipment ${shipment.providerOrderCode}`, error);
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedShipment = await tx.shipment.update({
        where: { id: shipmentId },
        data: { status: ShipmentStatus.CANCELLED, lastSyncedAt: new Date() },
      });

      await tx.orderEvent.create({
        data: {
          orderId: shipment.orderId,
          shipmentId,
          type: 'SHIPMENT_CANCELLED',
          source: 'SYSTEM',
          publicMessage: 'Vận đơn đã được hủy.',
          deduplicationKey: `shipment:${shipmentId}:cancel:${Date.now()}`,
        },
      });

      return updatedShipment;
    });

    this.logger.log(`Shipment ${shipmentId} cancelled`);
    return updated;
  }

  /**
   * Hỏi GHN trạng thái các vận đơn chưa kết thúc (MaintenanceService gọi định kỳ).
   * Webhook GHN vẫn là nguồn chính; đây là phần bù khi webhook không tới.
   */
  async syncActiveShipments() {
    const locked = await this.redisService.acquireLock(STATUS_SYNC_LOCK_KEY, STATUS_SYNC_LOCK_TTL_SECONDS);
    if (!locked) return { skipped: true as const, reason: 'locked' };

    try {
      const now = Date.now();
      const shipments = await this.prisma.shipment.findMany({
        where: {
          providerOrderCode: { not: null },
          status: { in: STATUS_SYNC_ACTIVE_STATUSES },
          createdAt: { gt: new Date(now - STATUS_SYNC_WINDOW_MS) },
          OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(now - STATUS_SYNC_MIN_INTERVAL_MS) } }],
        },
        orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
        take: STATUS_SYNC_BATCH_SIZE,
      });

      let updated = 0;
      let failed = 0;
      for (const shipment of shipments) {
        try {
          if (await this.syncShipmentStatus(shipment)) updated += 1;
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : 'unknown';
          this.logger.warn(`Shipment status sync failed | shipment=${shipment.id} code=${shipment.providerOrderCode}: ${message}`);
        }
      }
      return { skipped: false as const, checked: shipments.length, updated, failed };
    } finally {
      await this.redisService.releaseLock(STATUS_SYNC_LOCK_KEY);
    }
  }

  /** Ghi nhận trạng thái GHN khi nó khác và mới hơn trạng thái đang lưu; trả về true nếu có cập nhật. */
  private async syncShipmentStatus(shipment: Shipment) {
    const provider = shipment.provider as ShippingProviderType;
    const providerOrderCode = shipment.providerOrderCode as string;
    const tracking = await this.shippingService.getTracking(provider, providerOrderCode);
    const rawStatus = (tracking.rawStatus ?? '').trim().toLowerCase();
    const changed = rawStatus !== '' && rawStatus !== (shipment.rawStatus ?? '').trim().toLowerCase();
    // Không lùi trạng thái: bỏ qua mốc GHN cũ hơn mốc đang lưu (vd. vận đơn đã giả lập trên staging).
    const newer =
      !shipment.providerEventAt ||
      (tracking.providerEventAt !== undefined && tracking.providerEventAt > shipment.providerEventAt);

    const apply = changed && newer;
    if (apply) {
      await this.shippingService.handleShippingStatus({
        provider,
        providerOrderCode,
        shipmentId: shipment.id,
        shipmentStatus: tracking.status,
        rawStatus: tracking.rawStatus,
        eventKey: `${provider}:${providerOrderCode}:AUTO_SYNC:${rawStatus}:${tracking.providerEventAt?.toISOString() ?? 'unknown'}`,
        eventType: 'AUTO_SYNC',
        payload: tracking.raw as Record<string, unknown>,
        source: 'AUTO_SYNC',
        providerEventAt: tracking.providerEventAt,
      });
    }

    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        lastSyncedAt: new Date(),
        ...(tracking.expectedDeliveryTime ? { expectedDeliveryTime: tracking.expectedDeliveryTime } : {}),
      },
    });
    return apply;
  }

  private mapProviderStatus(status: ShipmentStatus): ShipmentStatus {
    const map: Partial<Record<ShipmentStatus, ShipmentStatus>> = {
      [ShipmentStatus.READY_TO_PICK]: ShipmentStatus.READY_TO_PICK,
      [ShipmentStatus.CREATED]: ShipmentStatus.READY_TO_PICK,
      [ShipmentStatus.PICKING]: ShipmentStatus.PICKING,
      [ShipmentStatus.PICKED]: ShipmentStatus.PICKED,
      [ShipmentStatus.IN_TRANSIT]: ShipmentStatus.SHIPPING,
      [ShipmentStatus.DELIVERING]: ShipmentStatus.SHIPPING,
      [ShipmentStatus.SHIPPING]: ShipmentStatus.SHIPPING,
      [ShipmentStatus.DELIVERED]: ShipmentStatus.DELIVERED,
      [ShipmentStatus.DELIVERY_FAILED]: ShipmentStatus.DELIVERY_FAILED,
      [ShipmentStatus.RETURNING]: ShipmentStatus.RETURNING,
      [ShipmentStatus.RETURNED]: ShipmentStatus.RETURNED,
      [ShipmentStatus.CANCELLED]: ShipmentStatus.CANCELLED,
    };
    return map[status] ?? status;
  }

  private buildShippingInfo(order: OrderWithItems) {
    const shippingInfo = (order.shippingInfo ?? {}) as {
      name?: string;
      phone?: string;
      address?: string;
      note?: string;
      notes?: string;
      provinceName?: string;
      wardName?: string;
      ghnProvinceV3Id?: string;
      ghnWardV3Id?: string;
    };
    return shippingInfo;
  }

  private assertShipmentAddress(shippingInfo: Record<string, unknown>) {
    if (shippingInfo.ghnProvinceV3Id && shippingInfo.ghnWardV3Id) return;
    throw new ConflictException({
      code: 'ADDRESS_RECONFIRM_REQUIRED',
      message: 'Địa chỉ giao hàng thiếu Tỉnh/Phường mới. Vui lòng yêu cầu khách xác nhận lại địa chỉ trước khi tạo vận đơn.',
      details: {
        addressId: typeof shippingInfo.addressId === 'string' ? shippingInfo.addressId : null,
        currentVersion: typeof shippingInfo.addressVersion === 'number' ? shippingInfo.addressVersion : null,
        reason: 'ADDRESS_INCOMPLETE',
      },
    });
  }

  private buildShipmentInput(order: OrderWithItems, shippingInfo: Record<string, unknown>) {
    const items = order.items ?? [];
    const weight = Math.max(500, items.reduce((sum, item) => sum + item.quantity * 500, 0));
    return {
      orderId: order.id,
      clientOrderCode: `ORD-${order.orderCode}`,
      sender: { address: 'FashionAI workshop' },
      receiver: {
        name: shippingInfo.name as string,
        phone: shippingInfo.phone as string,
        address: (shippingInfo.address as string) || '',
        provinceId: shippingInfo.ghnProvinceV3Id as string,
        wardId: shippingInfo.ghnWardV3Id as string,
        provinceName: shippingInfo.provinceName as string,
        wardName: shippingInfo.wardName as string,
      },
      items: items.map((item) => ({
        name: (item as any).productNameSnapshot || 'FashionAI item',
        code: item.productId,
        quantity: item.quantity,
        price: Number(item.price),
        weight: 500,
      })),
      weight,
      dimensions: { length: 25, width: 20, height: 8 },
      codAmount: 0,
      insuranceValue: shipmentInsuranceValueVnd(items),
      note: (shippingInfo.note as string) ?? (shippingInfo.notes as string),
    };
  }
}
