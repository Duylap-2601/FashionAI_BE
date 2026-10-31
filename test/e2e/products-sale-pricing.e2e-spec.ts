import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ProductsController } from '../../src/modules/products/products.controller';
import { ProductsService } from '../../src/modules/products/products.service';
import { ReviewsService } from '../../src/modules/products/reviews.service';
import { SalePricingService } from '../../src/modules/sale-campaigns/sale-pricing.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { createPrismaMock, createTestApp, PrismaMock } from './helpers/test-app';

const PRODUCT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B = '22222222-2222-4222-8222-222222222222';
const PRODUCT_C = '33333333-3333-4333-8333-333333333333';

const pricedProducts = [
  { id: PRODUCT_A, price: 1_000_000 },
  { id: PRODUCT_B, price: 800_000 },
  { id: PRODUCT_C, price: 600_000 },
];

function fullProduct(id: string, price: number, name: string) {
  return {
    id,
    name,
    price,
    category: 'UPPER',
    garmentType: null,
    status: 'ACTIVE',
    colors: [],
    images: [],
  };
}

function saleRow(productId: string, id: string, discountPercent: number) {
  return {
    productId,
    campaign: {
      id,
      name: id,
      discountPercent,
      startsAt: null,
      endsAt: null,
    },
  };
}

describe('Products sale pricing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock();
    prisma.product.findMany.mockImplementation(async (args: any) => {
      if (args?.include?.images) {
        return [
          fullProduct(PRODUCT_B, 800_000, 'B'),
          fullProduct(PRODUCT_C, 600_000, 'C'),
          fullProduct(PRODUCT_A, 1_000_000, 'A'),
        ];
      }
      return pricedProducts;
    });

    const created = await createTestApp({
      prisma,
      metadata: {
        controllers: [ProductsController],
        providers: [
          ProductsService,
          SalePricingService,
          { provide: ReviewsService, useValue: {} },
          { provide: StorageService, useValue: {} },
        ],
      },
    });
    app = created.app;
  });

  afterEach(async () => {
    await app?.close();
  });

  it('sorts by effective sale price and re-orders the page', async () => {
    prisma.saleCampaignItem.findMany.mockResolvedValue([
      saleRow(PRODUCT_A, 'campaign-a', 30),
      saleRow(PRODUCT_B, 'campaign-b', 6.25),
    ]);

    const res = await request(app.getHttpServer())
      .get('/api/products?sort=price_asc&page=1&limit=10')
      .expect(200);

    expect(res.body.data.map((item: { id: string }) => item.id)).toEqual([
      PRODUCT_C,
      PRODUCT_A,
      PRODUCT_B,
    ]);
    expect(res.body.data[0].sale).toBeNull();
    expect(res.body.data[1].sale).toEqual({ percent: 30, salePrice: 700_000 });
    expect(res.body.data[2].sale).toEqual({ percent: 6.25, salePrice: 750_000 });
    expect(res.body.meta.total).toBe(3);
  });

  it('filters by effective sale price instead of list price', async () => {
    prisma.saleCampaignItem.findMany.mockResolvedValue([
      saleRow(PRODUCT_A, 'campaign-a', 30),
      saleRow(PRODUCT_B, 'campaign-b', 6.25),
    ]);

    const minRes = await request(app.getHttpServer())
      .get('/api/products?sort=price_asc&minPrice=700000')
      .expect(200);
    expect(minRes.body.data.map((item: { id: string }) => item.id)).toEqual([
      PRODUCT_A,
      PRODUCT_B,
    ]);
    expect(minRes.body.meta.total).toBe(2);

    const maxRes = await request(app.getHttpServer())
      .get('/api/products?sort=price_asc&maxPrice=700000')
      .expect(200);
    expect(maxRes.body.data.map((item: { id: string }) => item.id)).toEqual([
      PRODUCT_C,
      PRODUCT_A,
    ]);
    expect(maxRes.body.meta.total).toBe(2);
  });

  it('attaches the active sale on product detail', async () => {
    prisma.product.findUnique.mockResolvedValue(fullProduct(PRODUCT_A, 1_000_000, 'A'));
    prisma.saleCampaignItem.findMany.mockResolvedValue([saleRow(PRODUCT_A, 'campaign-a', 30)]);

    const res = await request(app.getHttpServer())
      .get(`/api/products/${PRODUCT_A}`)
      .expect(200);

    expect(res.body.data).toMatchObject({
      id: PRODUCT_A,
      price: 1_000_000,
      sale: { percent: 30, salePrice: 700_000 },
    });
  });
});
