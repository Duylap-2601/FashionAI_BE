import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ShippingService } from './shipping.service';
import { ShippingProviderType } from './constants/shipping-provider.enum';

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

@Injectable()
export class ShipmentService {
  private readonly logger = new Logger(ShipmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shippingService: ShippingService,
  ) {}

  /**
   * Create shipment from order. Called by outbox processor after order is CONFIRMED.
   * Does NOT run inside the same transaction as the order state change.
   */
  async createShipmentFromOrder(order: OrderWithItems) {
    const provider = this.shippingService.getConfiguredProvider();
    const shippingInfo = this.buildShippingInfo(order);
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
            providerOrderCode: result.providerOrderCode,
            shippingFee: new Prisma.Decimal(result.shippingFee),
            shippingFeeVnd: BigInt(Math.round(result.shippingFee)),
            actualShippingFee: new Prisma.Decimal(result.shippingFee),
            expectedDeliveryTime: result.expectedDeliveryTime,
            trackingData: result.raw as Prisma.InputJsonValue,
            lastSyncedAt: new Date(),
          },
        });

        await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.SHIPPING },
        });

        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            shipmentId: updated.id,
            type: 'SHIPMENT_CREATED',
            source: 'SYSTEM',
            fromStatus: OrderStatus.CONFIRMED,
            toStatus: OrderStatus.SHIPPING,
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
      districtName?: string;
      wardName?: string;
      ghnDistrictId?: number;
      ghnWardCode?: string;
      districtId?: number;
      wardCode?: string;
    };
    return shippingInfo;
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
        provinceName: shippingInfo.provinceName as string,
        districtName: shippingInfo.districtName as string,
        wardName: shippingInfo.wardName as string,
        districtId: (shippingInfo.ghnDistrictId as number) ?? (shippingInfo.districtId as number),
        wardCode: (shippingInfo.ghnWardCode as string) ?? (shippingInfo.wardCode as string),
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
      insuranceValue: Number(order.amount),
      note: (shippingInfo.note as string) ?? (shippingInfo.notes as string),
    };
  }
}
