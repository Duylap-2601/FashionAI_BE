import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OrdersController } from '../../src/modules/orders/orders.controller';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { MailQueueService } from '../../src/modules/mail/mail-queue.service';
import { NotificationService } from '../../src/modules/notification/notification.service';
import { ShippingService } from '../../src/modules/shipping/shipping.service';
import { UserAddressesService } from '../../src/modules/users/user-addresses.service';
import { SalePricingService } from '../../src/modules/sale-campaigns/sale-pricing.service';
import { StorageService } from '../../src/modules/storage/storage.service';
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
  brand: 'StAie. SIGNATURE',
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
  let saleMap: Map<string, { campaignId: string; campaignName: string; percent: number; salePrice: number }>;

  beforeEach(async () => {
    saleMap = new Map();
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
          {
            provide: SalePricingService,
            useValue: {
              resolveSaleForProducts: jest.fn().mockImplementation(async () => saleMap),
            },
          },
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
          {
            provide: StorageService,
            useValue: {
              uploadImage: jest.fn().mockResolvedValue('https://cdn.test/refund-receipts/x.png'),
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

  it('quote sale + coupon, rồi tạo đơn snapshot giá niêm yết và giá sale', async () => {
    saleMap = new Map([
      [PRODUCT_ID, { campaignId: 'campaign-a', campaignName: 'Sale Thu', percent: 30, salePrice: 903000 }],
    ]);
    prisma.coupon = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'coupon-1',
        code: 'SALE10',
        isActive: true,
        startsAt: null,
        expiresAt: null,
        minOrderVnd: BigInt(900000),
        usageLimit: null,
        usageLimitPerUser: null,
        discountType: 'PERCENTAGE',
        discountValue: 10,
        maxDiscountVnd: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    };
    prisma.couponRedemption = {
      create: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    };

    const quoteBody = { ...body({ quantity: 2 }), couponCode: 'SALE10' };
    const quote = await request(app.getHttpServer())
      .post('/api/orders/quote')
      .send(quoteBody)
      .expect(201);

    expect(quote.body.data).toMatchObject({
      itemsTotal: 1806000,
      listItemsTotal: 2580000,
      shippingFee: 30000,
      discountAmount: 180600,
      totalAmount: 1655400,
      couponCode: 'SALE10',
    });

    const res = await request(app.getHttpServer())
      .post('/api/orders')
      .send({ ...quoteBody, quoteToken: quote.body.data.quoteToken })
      .expect(201);

    const createdItem = prisma.order.create.mock.calls[0][0].data.items.create[0];
    expect(Number(createdItem.price)).toBe(903000);
    expect(createdItem).toMatchObject({
      listUnitPriceVnd: BigInt(1290000),
      unitPriceVnd: BigInt(903000),
      lineTotalVnd: BigInt(1806000),
    });
    expect(res.body.data).toMatchObject({
      itemsTotal: 1806000,
      listItemsTotal: 2580000,
    });
    expect(res.body.data.items[0]).toMatchObject({
      listUnitPriceVnd: 1290000,
      unitPriceVnd: 903000,
      lineTotalVnd: 1806000,
    });
  });

  it('so coupon minOrderVnd với tạm tính sau sale', async () => {
    saleMap = new Map([
      [PRODUCT_ID, { campaignId: 'campaign-a', campaignName: 'Sale Thu', percent: 30, salePrice: 903000 }],
    ]);
    prisma.coupon = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'coupon-1',
        code: 'MIN1M',
        isActive: true,
        startsAt: null,
        expiresAt: null,
        minOrderVnd: BigInt(1000000),
        usageLimit: null,
        usageLimitPerUser: null,
        discountType: 'PERCENTAGE',
        discountValue: 10,
        maxDiscountVnd: null,
      }),
    };

    const quote = await request(app.getHttpServer())
      .post('/api/orders/quote')
      .send({ ...body({}), couponCode: 'MIN1M' })
      .expect(400);

    expect(quote.body.message).toContain('tối thiểu');
  });

  it('trả 409 khi hai đơn tranh lượt cuối: claim nguyên tử thất bại', async () => {
    prisma.coupon = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'coupon-1',
        code: 'LASTONE',
        isActive: true,
        startsAt: null,
        expiresAt: null,
        minOrderVnd: null,
        usageLimit: 1,
        usageLimitPerUser: null,
        discountType: 'PERCENTAGE',
        discountValue: 10,
        maxDiscountVnd: null,
      }),
    };
    prisma.couponRedemption = {
      create: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    };
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const res = await request(app.getHttpServer())
      .post('/api/orders')
      .send({ ...body({}), couponCode: 'LASTONE' })
      .expect(409);

    expect(res.body.code).toBe('COUPON_EXHAUSTED');
    expect(prisma.couponRedemption.create).not.toHaveBeenCalled();
  });

  it('trả 409 QUOTE_CHANGED khi sale kết thúc giữa quote và tạo đơn', async () => {
    saleMap = new Map([
      [PRODUCT_ID, { campaignId: 'campaign-a', campaignName: 'Sale Thu', percent: 30, salePrice: 903000 }],
    ]);

    const quote = await request(app.getHttpServer())
      .post('/api/orders/quote')
      .send(body({}))
      .expect(201);
    expect(quote.body.data.itemsTotal).toBe(903000);

    saleMap = new Map();
    const res = await request(app.getHttpServer())
      .post('/api/orders')
      .send({ ...body({}), quoteToken: quote.body.data.quoteToken })
      .expect(409);

    expect(res.body.code).toBe('QUOTE_CHANGED');
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});
