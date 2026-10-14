import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OrdersController } from '../../src/modules/orders/orders.controller';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { MailQueueService } from '../../src/modules/mail/mail-queue.service';
import { NotificationService } from '../../src/modules/notification/notification.service';
import { ShippingService } from '../../src/modules/shipping/shipping.service';
import { UserAddressesService } from '../../src/modules/users/user-addresses.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { MEASUREMENT_LABELS } from '../../src/common/constants/measurement.constants';
import { createPrismaMock, createTestApp, PrismaMock } from './helpers/test-app';

const USER_ID = 'user-1';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const ADDRESS_ID = '22222222-2222-4222-8222-222222222222';

const product = {
  id: PRODUCT_ID,
  name: 'Combo Suit',
  category: 'UPPER',
  garmentType: null,
  price: 1290000,
  garmentUrl: 'https://img/suit.png',
  brand: 'StAle. SIGNATURE',
  material: null,
  status: 'ACTIVE',
  colors: [{ name: 'Black', hex: '#000000' }],
  images: [],
};

// Đủ mọi số đo để qua bước kiểm tra số đo bắt buộc.
const fullMeasurement = Object.fromEntries(Object.keys(MEASUREMENT_LABELS).map((field) => [field, 50]));

describe('POST /orders comboType (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock({
      userAddress: { findFirst: jest.fn().mockResolvedValue({ id: ADDRESS_ID, version: 1 }) },
    });
    prisma.product.findMany.mockResolvedValue([product]);
    prisma.measurement.findUnique.mockResolvedValue(fullMeasurement);
    prisma.order.create.mockImplementation(async ({ data }: { data: any }) => ({
      ...data,
      id: 'order-1',
      userId: USER_ID,
      amountPaidVnd: BigInt(0),
      amountRefundedVnd: BigInt(0),
      createdAt: new Date(),
      updatedAt: new Date(),
      items: data.items.create.map((item: any, index: number) => ({ id: `item-${index}`, ...item })),
      payments: [],
      refunds: [],
      shipments: [],
    }));

    const created = await createTestApp({
      prisma,
      metadata: {
        controllers: [OrdersController],
        providers: [
          OrdersService,
          { provide: MailQueueService, useValue: {} },
          { provide: NotificationService, useValue: { create: jest.fn().mockResolvedValue({}) } },
          {
            provide: ShippingService,
            useValue: {
              calculateFee: jest.fn().mockResolvedValue({
                provider: 'GHN',
                totalFee: 30000,
                serviceFee: 30000,
                insuranceFee: 0,
                codFee: 0,
                expectedDeliveryTime: null,
              }),
            },
          },
          {
            provide: UserAddressesService,
            useValue: {
              findOwned: jest.fn().mockResolvedValue({ id: ADDRESS_ID, version: 1 }),
              toShippingInfo: jest.fn().mockReturnValue({
                name: 'Nguyen Van A',
                phone: '0900000000',
                address: '1 Nguyen Trai',
                provinceName: 'TP. Hồ Chí Minh',
                wardName: 'Phường Bến Thành',
                ghnProvinceV3Id: 1,
                ghnWardV3Id: 2,
                note: '',
              }),
            },
          },
        ],
      },
      configure: (builder) =>
        builder.overrideGuard(JwtAuthGuard).useValue({
          canActivate: (context: any) => {
            context.switchToHttp().getRequest().user = { id: USER_ID, email: 'u@test.com', role: 'USER' };
            return true;
          },
        }),
    });
    app = created.app;
  });

  afterEach(async () => {
    await app?.close();
  });

  const body = (item: Record<string, unknown>) => ({
    items: [{ productId: PRODUCT_ID, quantity: 1, color: 'Black', ...item }],
    shippingAddressId: ADDRESS_ID,
    addressVersion: 1,
  });

  it('từ chối comboType không hợp lệ', async () => {
    await request(app.getHttpServer()).post('/api/orders').send(body({ comboType: 'vest' })).expect(400);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('lưu comboType lên dòng đơn và trả về cho khách', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/orders')
      .send(body({ comboType: 'blazer' }))
      .expect(201);

    const data = prisma.order.create.mock.calls[0][0].data;
    expect(data.items.create[0]).toMatchObject({ productId: PRODUCT_ID, color: 'Black', comboType: 'blazer' });
    expect(res.body.data.items[0].comboType).toBe('blazer');
  });

  it('không gửi comboType thì dòng đơn không có comboType', async () => {
    const res = await request(app.getHttpServer()).post('/api/orders').send(body({})).expect(201);

    const data = prisma.order.create.mock.calls[0][0].data;
    expect(data.items.create[0].comboType).toBeUndefined();
    expect(res.body.data.items[0].comboType ?? null).toBeNull();
  });
});
