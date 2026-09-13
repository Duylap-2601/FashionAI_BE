import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ShippingProviderType } from './constants/shipping-provider.enum';
import { CancelAdminShipmentDto } from './dto/cancel-admin-shipment.dto';
import { QueryAdminShipmentsDto } from './dto/query-admin-shipments.dto';
import { ShippingService } from './shipping.service';

const ISSUE_STATUSES: ShipmentStatus[] = [ShipmentStatus.DELIVERY_FAILED, ShipmentStatus.FAILED, ShipmentStatus.RETURNING];
const TERMINAL_STATUSES: ShipmentStatus[] = [ShipmentStatus.DELIVERED, ShipmentStatus.RETURNED, ShipmentStatus.CANCELLED];

@Injectable()
export class AdminShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shippingService: ShippingService,
  ) {}

  async findAll(query: QueryAdminShipmentsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.buildWhere(query);

    const [items, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      }),
      this.prisma.shipment.count({ where }),
    ]);

    return {
      items: items.map((shipment) => this.toListItem(shipment)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            items: true,
          },
        },
      },
    });
    if (!shipment) throw new NotFoundException('Không tìm thấy vận đơn');

    const [events, webhooks] = await Promise.all([
      this.prisma.orderEvent.findMany({
        where: { shipmentId: shipment.id },
        orderBy: { occurredAt: 'asc' },
      }),
      this.prisma.webhookEvent.findMany({
        where: { shipmentId: shipment.id },
        orderBy: { receivedAt: 'desc' },
      }),
    ]);

    return {
      ...this.toListItem(shipment),
      trackingUrl: shipment.trackingUrl,
      trackingData: shipment.trackingData,
      items: shipment.order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.productNameSnapshot,
        sku: item.productSkuSnapshot,
        quantity: item.quantity,
        price: Number(item.price),
      })),
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        source: event.source,
        fromShipmentStatus: event.fromShipmentStatus,
        toShipmentStatus: event.toShipmentStatus,
        publicMessage: event.publicMessage,
        internalNote: event.internalNote,
        occurredAt: event.occurredAt,
      })),
      webhooks: webhooks.map((webhook) => ({
        id: webhook.id,
        eventKey: webhook.eventKey,
        eventType: webhook.eventType,
        status: webhook.status,
        receivedAt: webhook.receivedAt,
        processedAt: webhook.processedAt,
        payload: webhook.payload,
      })),
    };
  }

  async sync(id: string) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id }, include: { order: true } });
    if (!shipment) throw new NotFoundException('Không tìm thấy vận đơn');
    if (!shipment.providerOrderCode) throw new BadRequestException('Vận đơn chưa có mã GHN để đồng bộ');

    const tracking = await this.shippingService.getTracking(
      shipment.provider as ShippingProviderType,
      shipment.providerOrderCode,
    );

    await this.shippingService.handleShippingStatus({
      provider: shipment.provider as ShippingProviderType,
      providerOrderCode: shipment.providerOrderCode,
      shipmentId: shipment.id,
      shipmentStatus: tracking.status,
      rawStatus: tracking.rawStatus,
      eventKey: `GHN:${shipment.providerOrderCode}:ADMIN_SYNC:${Date.now()}`,
      eventType: 'ADMIN_SYNC',
      payload: tracking.raw as Record<string, unknown>,
      source: 'ADMIN_SYNC',
      providerEventAt: tracking.providerEventAt,
    });

    if (tracking.expectedDeliveryTime) {
      await this.prisma.shipment.update({
        where: { id: shipment.id },
        data: { expectedDeliveryTime: tracking.expectedDeliveryTime },
      });
    }

    return this.findOne(id);
  }

  async cancel(id: string, dto: CancelAdminShipmentDto, actorId?: string) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id }, include: { order: true } });
    if (!shipment) throw new NotFoundException('Không tìm thấy vận đơn');
    if (TERMINAL_STATUSES.includes(shipment.status)) return this.findOne(id);

    if (shipment.providerOrderCode) {
      await this.shippingService.cancelShipment(
        shipment.provider as ShippingProviderType,
        shipment.providerOrderCode,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: shipment.id },
        data: { status: ShipmentStatus.CANCELLED, rawStatus: 'cancel', lastSyncedAt: new Date() },
      });
      await tx.orderEvent.create({
        data: {
          orderId: shipment.orderId,
          shipmentId: shipment.id,
          type: 'SHIPMENT_CANCELLED',
          source: 'ADMIN',
          actorId,
          fromStatus: shipment.order.status,
          toStatus: shipment.order.status,
          fromShipmentStatus: shipment.status,
          toShipmentStatus: ShipmentStatus.CANCELLED,
          publicMessage: 'Vận đơn đã được hủy.',
          internalNote: dto.reason,
          deduplicationKey: `shipment:${shipment.id}:cancel:${Date.now()}`,
        },
      });
    });

    return this.findOne(id);
  }

  private buildWhere(query: QueryAdminShipmentsDto): Prisma.ShipmentWhereInput {
    const where: Prisma.ShipmentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.rawStatus) where.rawStatus = { contains: query.rawStatus, mode: 'insensitive' };
    if (query.provider) where.provider = { contains: query.provider, mode: 'insensitive' };
    if (query.providerOrderCode) where.providerOrderCode = { contains: query.providerOrderCode, mode: 'insensitive' };
    if (query.issueOnly === 'true') where.status = { in: ISSUE_STATUSES };
    if (query.createdFrom || query.createdTo) where.createdAt = this.dateRange(query.createdFrom, query.createdTo);
    if (query.expectedFrom || query.expectedTo) where.expectedDeliveryTime = this.dateRange(query.expectedFrom, query.expectedTo);
    if (query.staleOnly === 'true') {
      where.OR = [
        ...(where.OR ?? []),
        { lastSyncedAt: null },
        { lastSyncedAt: { lt: new Date(Date.now() - 6 * 60 * 60 * 1000) } },
      ];
    }

    const orderFilters: Prisma.OrderWhereInput[] = [];
    if (query.orderCode) {
      const orderCode = Number(query.orderCode.replace(/^ORD-/i, ''));
      if (Number.isInteger(orderCode)) orderFilters.push({ orderCode });
    }
    if (query.customer) {
      orderFilters.push({
        user: {
          OR: [
            { name: { contains: query.customer, mode: 'insensitive' } },
            { email: { contains: query.customer, mode: 'insensitive' } },
          ],
        },
      });
    }
    if (query.phone) {
      orderFilters.push({
        shippingInfo: { path: ['phone'], string_contains: query.phone },
      });
    }
    if (orderFilters.length > 0) where.order = { AND: orderFilters };
    return where;
  }

  private dateRange(from?: string, to?: string) {
    return {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  private toListItem(shipment: Prisma.ShipmentGetPayload<{ include: { order: { include: { user: { select: { id: true; name: true; email: true } } } } } }>) {
    const receiver = (shipment.order.shippingInfo ?? shipment.order.shippingAddressSnapshot ?? {}) as Record<string, unknown>;
    return {
      id: shipment.id,
      provider: shipment.provider,
      providerOrderCode: shipment.providerOrderCode,
      status: shipment.status,
      rawStatus: shipment.rawStatus,
      shippingFeeVnd: shipment.shippingFeeVnd === null || shipment.shippingFeeVnd === undefined ? null : Number(shipment.shippingFeeVnd),
      shippingFee: shipment.shippingFee === null || shipment.shippingFee === undefined ? null : Number(shipment.shippingFee),
      actualShippingFee: shipment.actualShippingFee === null || shipment.actualShippingFee === undefined ? null : Number(shipment.actualShippingFee),
      quotedShippingFee: shipment.quotedShippingFee === null || shipment.quotedShippingFee === undefined ? null : Number(shipment.quotedShippingFee),
      expectedDeliveryTime: shipment.expectedDeliveryTime,
      providerEventAt: shipment.providerEventAt,
      lastSyncedAt: shipment.lastSyncedAt,
      createdAt: shipment.createdAt,
      updatedAt: shipment.updatedAt,
      order: {
        id: shipment.order.id,
        orderCode: shipment.order.orderCode,
        status: shipment.order.status,
        paymentStatus: shipment.order.paymentStatus,
        totalVnd: shipment.order.totalVnd === null || shipment.order.totalVnd === undefined ? null : Number(shipment.order.totalVnd),
        amount: Number(shipment.order.amount),
      },
      customer: {
        id: shipment.order.user.id,
        name: shipment.order.user.name,
        email: shipment.order.user.email,
        phone: typeof receiver.phone === 'string' ? receiver.phone : null,
      },
      receiver: {
        name: typeof receiver.name === 'string' ? receiver.name : null,
        phone: typeof receiver.phone === 'string' ? receiver.phone : null,
        address: typeof receiver.address === 'string' ? receiver.address : null,
        provinceName: typeof receiver.provinceName === 'string' ? receiver.provinceName : null,
        districtName: typeof receiver.districtName === 'string' ? receiver.districtName : null,
        wardName: typeof receiver.wardName === 'string' ? receiver.wardName : null,
      },
      canCancel: !TERMINAL_STATUSES.includes(shipment.status),
      issue: ISSUE_STATUSES.includes(shipment.status),
      stale: !shipment.lastSyncedAt || shipment.lastSyncedAt.getTime() < Date.now() - 6 * 60 * 60 * 1000,
    };
  }
}
