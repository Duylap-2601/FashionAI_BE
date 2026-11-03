import { ShipmentStatus } from '@prisma/client';
import { ShipmentService } from '../../src/modules/shipping/shipment.service';

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

function shipmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shipment-1',
    orderId: 'order-1',
    provider: 'GHN',
    providerOrderCode: 'LYFF9G',
    status: ShipmentStatus.READY_TO_PICK,
    rawStatus: 'ready_to_pick',
    providerEventAt: null,
    lastSyncedAt: minutesAgo(30),
    ...overrides,
  };
}

function setup(rows: ReturnType<typeof shipmentRow>[]) {
  const prisma: any = {
    shipment: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const shippingService = {
    getTracking: jest.fn(),
    handleShippingStatus: jest.fn().mockResolvedValue({ processed: true }),
  };
  const redis = {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ShipmentService(prisma, shippingService as never, redis as never);
  return { service, prisma, shippingService, redis };
}

describe('ShipmentService.syncActiveShipments', () => {
  it('GHN báo trạng thái mới hơn thì ghi nhận một lần qua handleShippingStatus', async () => {
    const pickedAt = new Date('2026-11-03T09:00:00Z');
    const { service, prisma, shippingService, redis } = setup([shipmentRow()]);
    shippingService.getTracking.mockResolvedValue({
      status: ShipmentStatus.PICKED,
      rawStatus: 'picked',
      providerEventAt: pickedAt,
      expectedDeliveryTime: new Date('2026-11-04T16:59:59Z'),
      raw: { code: 200 },
    });

    await expect(service.syncActiveShipments()).resolves.toEqual({ skipped: false, checked: 1, updated: 1, failed: 0 });

    expect(shippingService.handleShippingStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        shipmentId: 'shipment-1',
        shipmentStatus: ShipmentStatus.PICKED,
        rawStatus: 'picked',
        source: 'AUTO_SYNC',
        providerEventAt: pickedAt,
        // Khóa sự kiện cố định theo trạng thái + mốc GHN: lần quét sau trùng sẽ bị bỏ qua.
        eventKey: `GHN:LYFF9G:AUTO_SYNC:picked:${pickedAt.toISOString()}`,
      }),
    );
    expect(prisma.shipment.update).toHaveBeenCalledWith({
      where: { id: 'shipment-1' },
      data: { lastSyncedAt: expect.any(Date), expectedDeliveryTime: new Date('2026-11-04T16:59:59Z') },
    });
    expect(redis.releaseLock).toHaveBeenCalledWith('shipment-status-sync');
  });

  it('trạng thái không đổi thì chỉ cập nhật lastSyncedAt, không ghi lịch sử đơn', async () => {
    const { service, prisma, shippingService } = setup([shipmentRow()]);
    shippingService.getTracking.mockResolvedValue({
      status: ShipmentStatus.READY_TO_PICK,
      rawStatus: 'ready_to_pick',
      providerEventAt: new Date(),
      raw: {},
    });

    await expect(service.syncActiveShipments()).resolves.toMatchObject({ checked: 1, updated: 0 });
    expect(shippingService.handleShippingStatus).not.toHaveBeenCalled();
    expect(prisma.shipment.update).toHaveBeenCalledWith({ where: { id: 'shipment-1' }, data: { lastSyncedAt: expect.any(Date) } });
  });

  it('không lùi trạng thái khi mốc GHN cũ hơn mốc đang lưu (vận đơn đã giả lập)', async () => {
    const simulatedAt = minutesAgo(10);
    const { service, shippingService } = setup([
      shipmentRow({ status: ShipmentStatus.PICKED, rawStatus: 'picked', providerEventAt: simulatedAt }),
    ]);
    shippingService.getTracking.mockResolvedValue({
      status: ShipmentStatus.READY_TO_PICK,
      rawStatus: 'ready_to_pick',
      providerEventAt: minutesAgo(60),
      raw: {},
    });

    await expect(service.syncActiveShipments()).resolves.toMatchObject({ updated: 0 });
    expect(shippingService.handleShippingStatus).not.toHaveBeenCalled();
  });

  it('GHN không trả mốc thời gian thì không ghi đè trạng thái đã có mốc', async () => {
    const { service, shippingService } = setup([
      shipmentRow({ status: ShipmentStatus.PICKED, rawStatus: 'picked', providerEventAt: minutesAgo(10) }),
    ]);
    shippingService.getTracking.mockResolvedValue({ status: ShipmentStatus.READY_TO_PICK, rawStatus: 'ready_to_pick', raw: {} });

    await service.syncActiveShipments();
    expect(shippingService.handleShippingStatus).not.toHaveBeenCalled();
  });

  it('một vận đơn lỗi không chặn các vận đơn còn lại', async () => {
    const { service, shippingService } = setup([
      shipmentRow({ id: 'broken', providerOrderCode: 'BROKEN' }),
      shipmentRow({ id: 'ok', providerOrderCode: 'OK1' }),
    ]);
    shippingService.getTracking
      .mockRejectedValueOnce(new Error('GHN timeout'))
      .mockResolvedValueOnce({ status: ShipmentStatus.PICKED, rawStatus: 'picked', providerEventAt: new Date(), raw: {} });

    await expect(service.syncActiveShipments()).resolves.toEqual({ skipped: false, checked: 2, updated: 1, failed: 1 });
    expect(shippingService.handleShippingStatus).toHaveBeenCalledWith(expect.objectContaining({ shipmentId: 'ok' }));
  });

  it('chỉ quét vận đơn đang chạy, có mã GHN, trong 30 ngày và chưa sync trong 5 phút', async () => {
    const { service, prisma } = setup([]);
    await service.syncActiveShipments();

    const args = prisma.shipment.findMany.mock.calls[0][0];
    expect(args.where.providerOrderCode).toEqual({ not: null });
    expect(args.where.status.in).not.toEqual(expect.arrayContaining([ShipmentStatus.DELIVERED]));
    expect(args.where.status.in).not.toEqual(expect.arrayContaining([ShipmentStatus.CANCELLED]));
    expect(args.where.status.in).not.toEqual(expect.arrayContaining([ShipmentStatus.RETURNED]));
    expect(args.where.status.in).toEqual(expect.arrayContaining([ShipmentStatus.READY_TO_PICK, ShipmentStatus.DELIVERING]));
    expect(args.take).toBe(25);
  });

  it('đang có lượt khác chạy (khóa Redis) thì bỏ qua', async () => {
    const { service, prisma, redis } = setup([shipmentRow()]);
    redis.acquireLock.mockResolvedValue(false);

    await expect(service.syncActiveShipments()).resolves.toEqual({ skipped: true, reason: 'locked' });
    expect(prisma.shipment.findMany).not.toHaveBeenCalled();
    expect(redis.releaseLock).not.toHaveBeenCalled();
  });
});
