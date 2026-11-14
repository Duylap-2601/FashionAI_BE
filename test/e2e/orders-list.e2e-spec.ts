import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OrderStatus, Role } from '@prisma/client';
import { OrdersController } from '../../src/modules/orders/orders.controller';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { MailQueueService } from '../../src/modules/mail/mail-queue.service';
import { NotificationService } from '../../src/modules/notification/notification.service';
import { ShippingService } from '../../src/modules/shipping/shipping.service';
import { UserAddressesService } from '../../src/modules/users/user-addresses.service';
import { SalePricingService } from '../../src/modules/sale-campaigns/sale-pricing.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { createPrismaMock, createTestApp, PrismaMock } from './helpers/test-app';

const USER_ID = 'user-1';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ORDER_ID = '33333333-3333-4333-8333-333333333333';
const SUBSCRIPTION_ORDER_ID = '44444444-4444-4444-8444-444444444444';

let currentUser: { id: string; email: string; role: 'USER' | 'ADMIN' } = {
  id: USER_ID,
  email: 'u@test.com',
  role: 'USER',
};

const authGuardStub = {
  canActivate: (context: any) => {
    context.switchToHttp().getRequest().user = currentUser;
    return true;
  },
};

type OrderRow = Record<string, any>;

function buildOrder(overrides: OrderRow): OrderRow {
  return {
    id: PRODUCT_ORDER_ID,
    orderCode: 100001,
    userId: USER_ID,
    targetTier: null,
    amount: 1320000,
    status: OrderStatus.CREATED,
    paymentStatus: 'PENDING',
    refundStatus: 'NONE',
    fulfillmentFlowVersion: 1,
    shippingInfo: { name: 'Nguyen Van A', phone: '0900000000', address: '1 Nguyen Trai' },
    shippingAddressSnapshot: {},
    shippingQuoteSnapshot: {},
    paymentMethod: 'BANK_TRANSFER',
    paymentProvider: 'SEPAY',
    shippingFee: 30000,
    discountAmount: 0,
    couponCode: null,
    currency: 'VND',
    itemsSubtotalVnd: BigInt(1290000),
    shippingFeeVnd: BigInt(30000),
    discountVnd: BigInt(0),
    taxVnd: BigInt(0),
    totalVnd: BigInt(1320000),
    amountPaidVnd: BigInt(0),
    amountRefundedVnd: BigInt(0),
    refundConfirmedAt: null,
    refundEvidence: null,
    refundBankName: null,
    refundAccountNumber: null,
    refundAccountHolder: null,
    checkoutUrl: null,
    checkoutExpiresAt: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    items: [],
    payments: [],
    refunds: [],
    shipments: [],
    events: [],
    deliveryDisputes: [],
    ...overrides,
  };
}

const productItem = {
  id: 'item-1',
  orderId: PRODUCT_ORDER_ID,
  productId: PRODUCT_ID,
  quantity: 1,
  color: 'Black',
  comboType: 'blazer',
  measurementSnapshot: { height: 170, chest: 90 },
  measurementReview: null,
  productNameSnapshot: 'Combo Suit',
  productSkuSnapshot: null,
  productImageSnapshot: 'https://img/suit.png',
  productCategorySnapshot: 'UPPER',
  brandSnapshot: 'StAie. SIGNATURE',
  fabricSnapshot: null,
  price: 1290000,
  listUnitPriceVnd: BigInt(1290000),
  unitPriceVnd: BigInt(1290000),
  lineTotalVnd: BigInt(1290000),
  product: { id: PRODUCT_ID, name: 'Combo Suit', category: 'UPPER', garmentType: null, images: [] },
};

describe('GET /orders — đơn sản phẩm vs đơn mua gói (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;
  let productOrder: OrderRow;
  let subscriptionOrder: OrderRow;

  // Thay Postgres bằng cách lọc thật theo `where` mà service truyền xuống, để test
  // bắt được cả việc thiếu filter lẫn việc filter chỉ gắn vào một trong hai câu query.
  const matchesWhere = (row: OrderRow, where: OrderRow | undefined) => {
    if (!where) return true;
    if (where.id && row.id !== where.id) return false;
    if (where.orderCode !== undefined && row.orderCode !== where.orderCode) return false;
    if (where.userId && row.userId !== where.userId) return false;
    if (where.targetTier === null && row.targetTier !== null) return false;
    if (where.status && row.status !== where.status) return false;
    return true;
  };

  beforeEach(async () => {
    currentUser = { id: USER_ID, email: 'u@test.com', role: 'USER' };
    productOrder = buildOrder({
      id: PRODUCT_ORDER_ID,
      orderCode: 100001,
      targetTier: null,
      items: [productItem],
    });
    // Đơn mua gói thành viên: targetTier != null và không có items.
    subscriptionOrder = buildOrder({
      id: SUBSCRIPTION_ORDER_ID,
      orderCode: 100002,
      targetTier: 'PREMIUM',
      amount: 199000,
      itemsSubtotalVnd: BigInt(0),
      totalVnd: BigInt(199000),
      shippingFee: null,
      shippingFeeVnd: BigInt(0),
      items: [],
    });

    const rows = [productOrder, subscriptionOrder];

    prisma = createPrismaMock({
      orderConversation: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
    });
    prisma.order.findMany.mockImplementation(async ({ where }: { where?: OrderRow }) =>
      rows.filter((row) => matchesWhere(row, where)),
    );
    prisma.order.count.mockImplementation(async ({ where }: { where?: OrderRow }) =>
      rows.filter((row) => matchesWhere(row, where)).length,
    );
    prisma.order.findFirst.mockImplementation(async ({ where }: { where?: OrderRow }) =>
      rows.find((row) => matchesWhere(row, where)) ?? null,
    );

    const created = await createTestApp({
      prisma,
      metadata: {
        controllers: [OrdersController],
        providers: [
          OrdersService,
          { provide: SalePricingService, useValue: { resolveSaleForProducts: jest.fn().mockResolvedValue(new Map()) } },
          { provide: MailQueueService, useValue: {} },
          { provide: NotificationService, useValue: { create: jest.fn().mockResolvedValue({}) } },
          { provide: ShippingService, useValue: { calculateFee: jest.fn(), getTracking: jest.fn() } },
          { provide: UserAddressesService, useValue: { findOwned: jest.fn(), toShippingInfo: jest.fn() } },
          { provide: StorageService, useValue: { uploadImage: jest.fn() } },
        ],
      },
      configure: (builder) =>
        builder
          .overrideGuard(JwtAuthGuard)
          .useValue(authGuardStub)
          .overrideGuard(RolesGuard)
          .useValue({ canActivate: () => true }),
    });
    app = created.app;
  });

  afterEach(async () => {
    await app?.close();
  });

  it('chỉ trả đơn sản phẩm, loại đơn mua gói khỏi danh sách và khỏi meta.total', async () => {
    const res = await request(app.getHttpServer()).get('/api/orders').expect(200);

    expect(res.body.data.map((order: OrderRow) => order.id)).toEqual([PRODUCT_ORDER_ID]);
    expect(res.body.data[0].targetTier).toBeNull();
    expect(res.body.data[0].items).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);

    // findMany và count dùng chung một where, nên cả hai đều phải lọc đơn mua gói.
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: USER_ID, targetTier: null }) }),
    );
    expect(prisma.order.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: USER_ID, targetTier: null }) }),
    );
  });

  it('status=CREATED (nhắc đơn chưa thanh toán) không còn thấy đơn mua gói', async () => {
    const res = await request(app.getHttpServer()).get('/api/orders?status=CREATED').expect(200);

    expect(res.body.data.map((order: OrderRow) => order.id)).toEqual([PRODUCT_ORDER_ID]);
    expect(res.body.meta.total).toBe(1);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_ID, targetTier: null, status: OrderStatus.CREATED }),
      }),
    );
  });

  it('GET /orders/all (admin) vẫn trả đơn mua gói để đối soát', async () => {
    currentUser = { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' as Role };

    const res = await request(app.getHttpServer()).get('/api/orders/all').expect(200);

    const ids = res.body.data.map((order: OrderRow) => order.id);
    expect(ids).toEqual(expect.arrayContaining([PRODUCT_ORDER_ID, SUBSCRIPTION_ORDER_ID]));
    expect(res.body.meta.total).toBe(2);

    const where = (prisma.order.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.targetTier).toBeUndefined();
  });

  it('GET /orders/:id vẫn trả chi tiết đơn mua gói (trang kết quả / luồng hoàn tiền)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/orders/${SUBSCRIPTION_ORDER_ID}`)
      .expect(200);

    expect(res.body.data.id).toBe(SUBSCRIPTION_ORDER_ID);
    expect(res.body.data.targetTier).toBe('PREMIUM');
    expect(res.body.data.items).toEqual([]);
  });
});
