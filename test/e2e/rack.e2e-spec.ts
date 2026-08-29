import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RackController } from '../../src/modules/rack/rack.controller';
import { RackService } from '../../src/modules/rack/rack.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { createPrismaMock, createTestApp, PrismaMock } from './helpers/test-app';

function authGuardFor(userId: string) {
  return {
    canActivate: (context: any) => {
      context.switchToHttp().getRequest().user = {
        id: userId,
        email: `${userId}@test.com`,
      };
      return true;
    },
  };
}

describe('Rack (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;

  async function bootstrap(userId: string) {
    prisma = createPrismaMock();

    const created = await createTestApp({
      prisma,
      metadata: {
        controllers: [RackController],
        providers: [RackService],
      },
      configure: (builder) =>
        builder.overrideGuard(JwtAuthGuard).useValue(authGuardFor(userId)),
    });

    app = created.app;
  }

  afterEach(async () => {
    if (app) await app.close();
  });

  it('trả 404 khi pin sản phẩm không tồn tại', async () => {
    await bootstrap('user-a');
    prisma.product.findUnique.mockResolvedValue(null);

    await request(app.getHttpServer())
      .post('/api/rack')
      .send({ productId: '11111111-1111-4111-8111-111111111111' })
      .expect(404);
  });

  it('pin sản phẩm hợp lệ, gọi upsert với đúng userId/productId', async () => {
    await bootstrap('user-a');
    const productId = '11111111-1111-4111-8111-111111111111';
    prisma.product.findUnique.mockResolvedValue({ id: productId });
    prisma.rackItem.upsert.mockResolvedValue({
      id: 'rack-1',
      userId: 'user-a',
      productId,
      product: { id: productId, images: [] },
    });

    const res = await request(app.getHttpServer())
      .post('/api/rack')
      .send({ productId })
      .expect(200);

    expect(res.body.data.id).toBe('rack-1');
    expect(prisma.rackItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_productId: { userId: 'user-a', productId } },
      }),
    );
  });

  it('lấy danh sách rack chỉ giới hạn theo userId của người gọi', async () => {
    await bootstrap('user-b');
    prisma.rackItem.findMany.mockResolvedValue([]);

    await request(app.getHttpServer()).get('/api/rack').expect(200);

    expect(prisma.rackItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-b' } }),
    );
  });

  it('unpin trả 404 nếu item không thuộc user gọi', async () => {
    await bootstrap('user-b');
    prisma.rackItem.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer()).delete('/api/rack/rack-1').expect(404);
    expect(prisma.rackItem.delete).not.toHaveBeenCalled();
  });

  it('unpin thành công khi item thuộc user gọi', async () => {
    await bootstrap('user-a');
    prisma.rackItem.findFirst.mockResolvedValue({ id: 'rack-1', userId: 'user-a' });
    prisma.rackItem.delete.mockResolvedValue({});

    await request(app.getHttpServer()).delete('/api/rack/rack-1').expect(200);
    expect(prisma.rackItem.delete).toHaveBeenCalledWith({ where: { id: 'rack-1' } });
  });

  it('unpin all xóa toàn bộ item của user gọi', async () => {
    await bootstrap('user-a');
    prisma.rackItem.deleteMany.mockResolvedValue({ count: 3 });

    const res = await request(app.getHttpServer()).delete('/api/rack/all').expect(200);

    expect(res.body.data.deleted).toBe(3);
    expect(prisma.rackItem.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-a' } });
  });
});
