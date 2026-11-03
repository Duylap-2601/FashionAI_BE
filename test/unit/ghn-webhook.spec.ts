import { UnauthorizedException } from '@nestjs/common';
import { OrderStatus, ShipmentStatus } from '@prisma/client';
import { ShippingService } from '../../src/modules/shipping/shipping.service';

// Payload theo tài liệu callback trạng thái đơn của GHN (PascalCase).
const ghnPayload = {
  OrderCode: 'LYFGM6',
  ClientOrderCode: 'ORD-15560998',
  Type: 'switch_status',
  Status: 'picked',
  Time: '2026-11-03T10:00:00.000Z',
  Description: 'Lấy hàng thành công',
};

function setup(secret?: string, current: Record<string, unknown> = {}) {
  const prisma: any = {
    shipment: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'shipment-1',
        orderId: 'order-1',
        providerOrderCode: 'LYFGM6',
        status: ShipmentStatus.READY_TO_PICK,
        rawStatus: 'ready_to_pick',
        providerEventAt: null,
        order: { id: 'order-1', userId: 'user-1', orderCode: 15560998, status: OrderStatus.READY_TO_SHIP },
        ...current,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    webhookEvent: { create: jest.fn().mockResolvedValue({}) },
    order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  const config = { get: jest.fn((key: string) => (key === 'GHN_WEBHOOK_SECRET' ? secret : undefined)) };
  const ghnProvider = { mapWebhookStatus: (status: string) => (status === 'picked' ? ShipmentStatus.PICKED : ShipmentStatus.UNKNOWN) };
  const notifications = { create: jest.fn().mockResolvedValue({}) };
  const service = new ShippingService(config as any, prisma, {} as any, ghnProvider as any, {} as any, {} as any, notifications as any);
  return { service, prisma };
}

describe('GHN webhook', () => {
  it('nhận secret qua ?secret= trên URL (portal GHN chỉ cho đăng ký URL)', async () => {
    const { service, prisma } = setup('s3cret');

    await expect(service.handleGhnWebhook(ghnPayload, {}, { secret: 's3cret' })).resolves.toMatchObject({ processed: true });
    expect(prisma.webhookEvent.create.mock.calls[0][0].data.eventKey).toBe('GHN:LYFGM6:switch_status:2026-11-03T10:00:00.000Z');
    // Đơn đi theo GHN: đã lấy hàng → Đang giao.
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: OrderStatus.READY_TO_SHIP },
      data: { status: OrderStatus.SHIPPING },
    });
  });

  it('vẫn nhận secret qua header như trước', async () => {
    const { service } = setup('s3cret');
    await expect(service.handleGhnWebhook(ghnPayload, { 'x-webhook-secret': 's3cret' })).resolves.toMatchObject({ processed: true });
  });

  it.each([
    ['thiếu secret', {}, {}],
    ['sai secret trên URL', {}, { secret: 'wrong' }],
    ['secret không phải chuỗi', {}, { secret: ['s3cret'] }],
  ])('từ chối khi %s', async (_case, headers, query) => {
    const { service, prisma } = setup('s3cret');
    await expect(service.handleGhnWebhook(ghnPayload, headers, query)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.shipment.findFirst).not.toHaveBeenCalled();
  });

  it('chưa cấu hình GHN_WEBHOOK_SECRET thì không kiểm tra', async () => {
    const { service } = setup(undefined);
    await expect(service.handleGhnWebhook(ghnPayload, {})).resolves.toMatchObject({ processed: true });
  });

  it('callback lặp lại trạng thái hiện có (vd. update_fee) chỉ lưu audit, không thêm lịch sử đơn', async () => {
    const { service, prisma } = setup(undefined, {
      status: ShipmentStatus.PICKED,
      rawStatus: 'picked',
      order: { id: 'order-1', userId: 'user-1', orderCode: 15560998, status: OrderStatus.SHIPPING },
    });

    await expect(
      service.handleGhnWebhook({ ...ghnPayload, Type: 'update_fee', Time: '2026-11-03T10:05:00.000Z' }, {}),
    ).resolves.toMatchObject({ processed: true, unchanged: true });
    expect(prisma.webhookEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.shipment.update).toHaveBeenCalledTimes(1);
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.orderEvent.create).not.toHaveBeenCalled();
  });

  it('trạng thái vận đơn giữ nguyên nhưng đơn còn kẹt phía sau thì vẫn kéo đơn lên và ghi lịch sử', async () => {
    const { service, prisma } = setup(undefined, { status: ShipmentStatus.PICKED, rawStatus: 'picked' });

    await expect(service.handleGhnWebhook(ghnPayload, {})).resolves.toMatchObject({ processed: true });
    expect(prisma.orderEvent.create.mock.calls[0][0].data).toMatchObject({ fromStatus: OrderStatus.READY_TO_SHIP, toStatus: OrderStatus.SHIPPING });
  });
});
