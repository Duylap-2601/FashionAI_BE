import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { ProductsController } from '../../src/modules/products/products.controller';
import { ProductsService } from '../../src/modules/products/products.service';
import { ReviewsService } from '../../src/modules/products/reviews.service';
import { SalePricingService } from '../../src/modules/sale-campaigns/sale-pricing.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { createPrismaMock, createTestApp, PrismaMock } from './helpers/test-app';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

const adminAuthGuard = {
  canActivate: (context: any) => {
    context.switchToHttp().getRequest().user = { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' };
    return true;
  },
};

describe('Products gender (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = createPrismaMock();
    prisma.product.findMany.mockResolvedValue([]);
    prisma.product.count.mockResolvedValue(0);
    prisma.product.create.mockImplementation(async ({ data }: any) => ({ id: PRODUCT_ID, ...data, images: [] }));

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
      configure: (builder) => builder.overrideGuard(JwtAuthGuard).useValue(adminAuthGuard),
    });
    app = created.app;
  });

  afterEach(async () => {
    await app?.close();
  });

  it('filters the product list by exact gender', async () => {
    await request(app.getHttpServer()).get('/api/products?gender=MALE').expect(200);

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE', gender: 'MALE' }) }),
    );
  });

  it('rejects an unknown gender', async () => {
    await request(app.getHttpServer()).get('/api/products?gender=KIDS').expect(400);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('saves the gender sent by the admin form, and leaves it to the DB default when omitted', async () => {
    const base = { name: 'Áo Sơ Mi Nam', category: 'UPPER', price: 600000, garmentUrl: 'https://cdn.test/men-shirt.png' };

    await request(app.getHttpServer()).post('/api/products').send({ ...base, gender: 'MALE' }).expect(201);
    expect(prisma.product.create.mock.calls[0][0].data.gender).toBe('MALE');

    await request(app.getHttpServer()).post('/api/products').send(base).expect(201);
    expect(prisma.product.create.mock.calls[1][0].data.gender).toBeUndefined();

    await request(app.getHttpServer()).post('/api/products').send({ ...base, gender: 'KIDS' }).expect(400);
  });
});
