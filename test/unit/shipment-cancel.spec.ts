import { BadRequestException } from '@nestjs/common';
import { OrderStatus, ShipmentStatus } from '@prisma/client';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { AdminShipmentsService } from '../../src/modules/shipping/admin-shipments.service';

function shipment(status: ShipmentStatus) {
  return {
    id: 'shipment-1',
    orderId: 'order-1',
    provider: 'GHN',
    providerOrderCode: 'LYF9KM',
    status,
    rawStatus: status.toLowerCase(),
    order: { id: 'order-1', status: OrderStatus.SHIPPING, orderCode: 29188795 },
  };
}

describe('Hủy vận đơn chỉ khi GHN chưa lấy hàng', () => {
  function adminSetup(status: ShipmentStatus) {
    const prisma: any = {
      shipment: { findUnique: jest.fn().mockResolvedValue(shipment(status)), update: jest.fn() },
      orderEvent: { create: jest.fn() },
    };
    prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
    const shippingService = { cancelShipment: jest.fn().mockResolvedValue(undefined) };
    const service = new AdminShipmentsService(prisma, shippingService as never);
    jest.spyOn(service, 'findOne').mockResolvedValue({} as never);
    return { service, prisma, shippingService };
  }

  it.each([ShipmentStatus.PICKED, ShipmentStatus.SHIPPING, ShipmentStatus.DELIVERING, ShipmentStatus.RETURNING])(
    'admin hủy vận đơn %s: báo lỗi, không gọi GHN',
    async (status) => {
      const { service, shippingService, prisma } = adminSetup(status);
      await expect(service.cancel('shipment-1', {})).rejects.toBeInstanceOf(BadRequestException);
      expect(shippingService.cancelShipment).not.toHaveBeenCalled();
      expect(prisma.shipment.update).not.toHaveBeenCalled();
    },
  );

  it.each([ShipmentStatus.READY_TO_PICK, ShipmentStatus.PICKING])('admin hủy vận đơn %s: gọi GHN và đánh dấu đã hủy', async (status) => {
    const { service, shippingService, prisma } = adminSetup(status);
    await service.cancel('shipment-1', {});
    expect(shippingService.cancelShipment).toHaveBeenCalledWith('GHN', 'LYF9KM');
    expect(prisma.shipment.update.mock.calls[0][0].data.status).toBe(ShipmentStatus.CANCELLED);
  });

  it('nút hủy (canCancel) chỉ bật trước khi lấy hàng', () => {
    const { service } = adminSetup(ShipmentStatus.READY_TO_PICK);
    const listItem = (status: ShipmentStatus) =>
      service['toListItem']({
        ...shipment(status),
        order: { id: 'order-1', orderCode: 1, status: OrderStatus.SHIPPING, paymentStatus: 'PAID', amount: 0, shippingInfo: {}, user: { id: 'u', name: 'A', email: 'a@x' } },
      } as never) as { canCancel: boolean };
    expect(listItem(ShipmentStatus.READY_TO_PICK).canCancel).toBe(true);
    expect(listItem(ShipmentStatus.PICKED).canCancel).toBe(false);
    expect(listItem(ShipmentStatus.DELIVERED).canCancel).toBe(false);
  });

  it('API hủy vận đơn theo đơn (OrdersService) cũng chặn sau khi lấy hàng', async () => {
    const prisma: any = {
      order: { findFirst: jest.fn().mockResolvedValue({ id: 'order-1', userId: 'user-1' }), findUnique: jest.fn().mockResolvedValue({ id: 'order-1', userId: 'user-1' }) },
      shipment: { findFirst: jest.fn().mockResolvedValue(shipment(ShipmentStatus.PICKED)), update: jest.fn() },
    };
    const shippingService = { cancelShipment: jest.fn() };
    const service = new OrdersService(prisma, null as never, null as never, shippingService as never, null as never, null as never);
    jest.spyOn(service as any, 'findOrderByIdentifier').mockResolvedValue({ id: 'order-1', userId: 'user-1' });

    await expect(service.cancelShipment('order-1', {} as never, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(shippingService.cancelShipment).not.toHaveBeenCalled();
  });
});
