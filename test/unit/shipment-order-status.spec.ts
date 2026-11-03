import { OrderStatus, ShipmentStatus } from '@prisma/client';
import { orderStatusForShipment } from '../../src/modules/orders/utils/shipment-order-status.util';
import { ShippingService } from '../../src/modules/shipping/shipping.service';
import { ShippingProviderType } from '../../src/modules/shipping/constants/shipping-provider.enum';

describe('orderStatusForShipment: đơn đi theo vận đơn GHN', () => {
  it.each([
    [OrderStatus.READY_TO_SHIP, ShipmentStatus.PICKED, OrderStatus.SHIPPING],
    [OrderStatus.READY_TO_SHIP, ShipmentStatus.DELIVERING, OrderStatus.SHIPPING],
    [OrderStatus.READY_TO_SHIP, ShipmentStatus.DELIVERED, OrderStatus.DELIVERED],
    [OrderStatus.SHIPPING, ShipmentStatus.DELIVERED, OrderStatus.DELIVERED],
  ])('%s + vận đơn %s → %s', (order, shipment, expected) => {
    expect(orderStatusForShipment(order, shipment)).toBe(expected);
  });

  it.each([
    // Chưa rời shop hoặc vận đơn bị hủy: đơn giữ nguyên.
    [OrderStatus.READY_TO_SHIP, ShipmentStatus.READY_TO_PICK],
    [OrderStatus.READY_TO_SHIP, ShipmentStatus.PICKING],
    [OrderStatus.READY_TO_SHIP, ShipmentStatus.CANCELLED],
    // Giao thất bại / GHN hoàn hàng: vẫn "Đang giao", không vào luồng hoàn trả của khách.
    [OrderStatus.SHIPPING, ShipmentStatus.DELIVERY_FAILED],
    [OrderStatus.SHIPPING, ShipmentStatus.RETURNING],
    [OrderStatus.SHIPPING, ShipmentStatus.RETURNED],
    // Không lùi trạng thái và không đè đơn đã chốt / đang đổi trả.
    [OrderStatus.DELIVERED, ShipmentStatus.DELIVERING],
    [OrderStatus.DELIVERED, ShipmentStatus.DELIVERED],
    [OrderStatus.COMPLETED, ShipmentStatus.DELIVERED],
    [OrderStatus.CANCELLED, ShipmentStatus.PICKED],
    [OrderStatus.RETURN_REQUESTED, ShipmentStatus.DELIVERED],
  ])('%s + vận đơn %s → giữ nguyên', (order, shipment) => {
    expect(orderStatusForShipment(order, shipment)).toBeNull();
  });
});

describe('ShippingService.handleShippingStatus cập nhật trạng thái đơn', () => {
  function setup(orderStatus: OrderStatus, updatedCount = 1) {
    const prisma: any = {
      shipment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'shipment-1',
          orderId: 'order-1',
          providerOrderCode: 'LYFF9G',
          status: ShipmentStatus.READY_TO_PICK,
          providerEventAt: null,
          order: { id: 'order-1', userId: 'user-1', orderCode: 15894496, status: orderStatus },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      webhookEvent: { create: jest.fn().mockResolvedValue({}) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: updatedCount }) },
      orderEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
    const notifications = { create: jest.fn().mockResolvedValue({}) };
    const service = new ShippingService({} as any, prisma, {} as any, {} as any, {} as any, {} as any, notifications as any);
    return { service, prisma, notifications };
  }

  const event = (shipmentStatus: ShipmentStatus, rawStatus: string) => ({
    provider: ShippingProviderType.GHN,
    shipmentId: 'shipment-1',
    shipmentStatus,
    rawStatus,
    eventKey: `GHN:LYFF9G:status:${rawStatus}`,
    source: 'AUTO_SYNC',
  });

  it('GHN đã giao: đơn sang DELIVERED, lịch sử ghi đúng trạng thái và báo khách', async () => {
    const { service, prisma, notifications } = setup(OrderStatus.SHIPPING);

    await service.handleShippingStatus(event(ShipmentStatus.DELIVERED, 'delivered'));

    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: OrderStatus.SHIPPING },
      data: { status: OrderStatus.DELIVERED },
    });
    expect(prisma.orderEvent.create.mock.calls[0][0].data).toMatchObject({
      fromStatus: OrderStatus.SHIPPING,
      toStatus: OrderStatus.DELIVERED,
      toShipmentStatus: ShipmentStatus.DELIVERED,
      type: 'SHIPMENT_SYNCED',
    });
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', data: expect.objectContaining({ status: OrderStatus.DELIVERED }) }),
    );
  });

  it('đơn vừa bị đổi trạng thái ở nơi khác (updateMany = 0) thì không ghi đè, không báo', async () => {
    const { service, prisma, notifications } = setup(OrderStatus.READY_TO_SHIP, 0);

    await service.handleShippingStatus(event(ShipmentStatus.PICKED, 'picked'));

    expect(prisma.orderEvent.create.mock.calls[0][0].data.toStatus).toBe(OrderStatus.READY_TO_SHIP);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('vận đơn chưa rời shop thì chỉ cập nhật vận đơn', async () => {
    const { service, prisma, notifications } = setup(OrderStatus.READY_TO_SHIP);

    await service.handleShippingStatus(event(ShipmentStatus.PICKING, 'picking'));

    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.shipment.update).toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });
});
