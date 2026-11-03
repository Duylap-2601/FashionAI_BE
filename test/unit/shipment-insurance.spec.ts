import { Prisma, ShipmentStatus } from '@prisma/client';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { ShipmentService } from '../../src/modules/shipping/shipment.service';
import { shipmentInsuranceValueVnd } from '../../src/modules/shipping/utils/shipment-insurance.util';

// Đơn thật từ E2E 03/11: 1.850.000 tiền hàng, mã giảm 10%, ship 77.450.
// order.amount = 1.742.450 khác tiền hàng, nên khai bảo hiểm theo amount
// làm GHN tính phí thấp hơn phí khách đã trả (76.913 so với 77.450).
const items = [
  { productId: 'blazer', quantity: 1, price: new Prisma.Decimal(750_000), productNameSnapshot: 'Blazer' },
  { productId: 'shirt', quantity: 1, price: new Prisma.Decimal(550_000), productNameSnapshot: 'Sơ mi' },
  { productId: 'pants', quantity: 1, price: new Prisma.Decimal(550_000), productNameSnapshot: 'Quần' },
];
const shippingInfo = {
  name: 'Khách',
  phone: '0900000000',
  address: '1 Đường A',
  provinceName: 'Tây Ninh',
  wardName: 'Phường Thanh Điền',
  ghnProvinceV3Id: 'p-1',
  ghnWardV3Id: 'w-1',
};
const order = {
  id: 'order-1',
  orderCode: 15894496,
  status: 'READY_TO_SHIP',
  amount: new Prisma.Decimal(1_742_450),
  shippingFee: new Prisma.Decimal(77_450),
  shippingFeeVnd: BigInt(77_450),
  shippingInfo,
  items,
};

describe('shipmentInsuranceValueVnd', () => {
  it('cộng đơn giá × số lượng, không phụ thuộc mã giảm giá hay phí ship', () => {
    expect(shipmentInsuranceValueVnd(items)).toBe(1_850_000);
    expect(shipmentInsuranceValueVnd([{ price: '120000', quantity: 3 }])).toBe(360_000);
    expect(shipmentInsuranceValueVnd([])).toBe(0);
  });
});

describe('giá trị bảo hiểm GHN: báo giá và tạo vận đơn phải khớp nhau', () => {
  it('admin tạo vận đơn (OrdersService) khai cùng giá trị với lúc báo giá', async () => {
    const calculateFee = jest.fn().mockResolvedValue({ totalFee: 77_450 });
    const service = new OrdersService(
      null as never,
      null as never,
      null as never,
      { calculateFee } as never,
      null as never,
      null as never,
    );
    await service['calculateOrderShippingFee'](
      {
        items: items.map(({ productId, quantity }) => ({ productId, quantity })),
        shippingInfo: { ...shippingInfo, provinceName: shippingInfo.provinceName },
      } as never,
      1_850_000,
    );
    const quoted = calculateFee.mock.calls[0][0].insuranceValue;

    const shipmentInput = service['buildShipmentInput'](order as never);

    expect(quoted).toBe(1_850_000);
    expect(shipmentInput.insuranceValue).toBe(quoted);
    expect(shipmentInput.insuranceValue).not.toBe(Number(order.amount));
  });

  it('outbox tạo vận đơn (ShipmentService) cũng khai theo tiền hàng', async () => {
    const createShipment = jest.fn().mockResolvedValue({
      providerOrderCode: 'LYFF9G',
      status: ShipmentStatus.READY_TO_PICK,
      rawStatus: 'ready_to_pick',
      shippingFee: 77_450,
    });
    const prisma: any = {
      shipment: {
        create: jest.fn().mockResolvedValue({ id: 'shipment-1' }),
        update: jest.fn().mockResolvedValue({ id: 'shipment-1' }),
      },
      orderEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
    const service = new ShipmentService(
      prisma,
      { getConfiguredProvider: () => 'GHN', createShipment } as never,
      null as never,
    );

    await service.createShipmentFromOrder(order as never);

    expect(createShipment.mock.calls[0][0].insuranceValue).toBe(1_850_000);
  });
});
