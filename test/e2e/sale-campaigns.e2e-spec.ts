import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { SaleCampaignsController } from '../../src/modules/sale-campaigns/sale-campaigns.controller';
import { SaleCampaignsService } from '../../src/modules/sale-campaigns/sale-campaigns.service';
import { createPrismaMock, createTestApp, PrismaMock } from './helpers/test-app';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222';

const adminAuthGuard = {
  canActivate: (context: any) => {
    context.switchToHttp().getRequest().user = {
      id: 'admin-1',
      email: 'admin@test.com',
      role: 'ADMIN',
    };
    return true;
  },
};

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    name: 'Sale Thu 2026',
    discountPercent: 30,
    isActive: true,
    startsAt: new Date('2026-11-01T00:00:00.000Z'),
    endsAt: new Date('2026-11-15T23:59:59.000Z'),
    createdAt: new Date('2026-10-31T00:00:00.000Z'),
    updatedAt: new Date('2026-10-31T00:00:00.000Z'),
    _count: { items: 1 },
    ...overrides,
  };
}

describe('Sale campaigns admin (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock();
    const created = await createTestApp({
      prisma,
      metadata: {
        controllers: [SaleCampaignsController],
        providers: [SaleCampaignsService],
      },
      configure: (builder) => builder.overrideGuard(JwtAuthGuard).useValue(adminAuthGuard),
    });
    app = created.app;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('creates a campaign with products', async () => {
    prisma.product.findMany.mockResolvedValue([{ id: PRODUCT_ID }]);
    prisma.saleCampaign.findMany.mockResolvedValue([]);
    prisma.saleCampaign.create.mockResolvedValue(campaign());

    const res = await request(app.getHttpServer())
      .post('/api/sale-campaigns')
      .send({
        name: 'Sale Thu 2026',
        discountPercent: 30,
        isActive: true,
        startsAt: '2026-11-01T00:00:00.000Z',
        endsAt: '2026-11-15T23:59:59.000Z',
        productIds: [PRODUCT_ID],
      })
      .expect(201);

    expect(res.body.data).toMatchObject({
      id: CAMPAIGN_ID,
      name: 'Sale Thu 2026',
      discountPercent: 30,
      productCount: 1,
    });
    expect(prisma.saleCampaign.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        items: { create: [{ productId: PRODUCT_ID }] },
      }),
    }));
  });

  it('rejects an overlapping active campaign on the same product', async () => {
    prisma.product.findMany.mockResolvedValue([{ id: PRODUCT_ID }]);
    prisma.saleCampaign.findMany.mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Sale cũ',
        startsAt: new Date('2026-10-01T00:00:00.000Z'),
        endsAt: new Date('2026-12-01T00:00:00.000Z'),
        items: [{ productId: PRODUCT_ID }],
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/api/sale-campaigns')
      .send({
        name: 'Sale trùng',
        discountPercent: 20,
        productIds: [PRODUCT_ID],
      })
      .expect(409);

    expect(res.body.code).toBe('SALE_CAMPAIGN_OVERLAP');
    expect(prisma.saleCampaign.create).not.toHaveBeenCalled();
  });

  it('updates a campaign and can clear its time window', async () => {
    prisma.saleCampaign.findUnique.mockResolvedValue({
      ...campaign(),
      items: [],
    });
    prisma.saleCampaign.update.mockResolvedValue(campaign({ startsAt: null, endsAt: null }));

    const res = await request(app.getHttpServer())
      .patch(`/api/sale-campaigns/${CAMPAIGN_ID}`)
      .send({ startsAt: null, endsAt: null })
      .expect(200);

    expect(res.body.data).toMatchObject({ id: CAMPAIGN_ID, startsAt: null, endsAt: null });
    expect(prisma.saleCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ startsAt: null, endsAt: null }),
    }));
  });

  it('lists campaigns with pagination metadata', async () => {
    prisma.saleCampaign.findMany.mockResolvedValue([campaign()]);
    prisma.saleCampaign.count.mockResolvedValue(1);

    const res = await request(app.getHttpServer())
      .get('/api/sale-campaigns?page=1&limit=10')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ total: 1, page: 1, limit: 10, totalPages: 1 });
  });
});
