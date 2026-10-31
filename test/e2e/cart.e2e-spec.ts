import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CartController } from '../../src/modules/cart/cart.controller';
import { CartService } from '../../src/modules/cart/cart.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { RealtimeEmitter } from '../../src/modules/realtime/realtime.emitter';
import { SalePricingService } from '../../src/modules/sale-campaigns/sale-pricing.service';
import { createPrismaMock, createTestApp, PrismaMock } from './helpers/test-app';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const CART_ITEM_ID = '22222222-2222-4222-8222-222222222222';

const activeProduct = {
  id: PRODUCT_ID,
  name: 'Áo blazer',
  status: 'ACTIVE',
  colors: [{ name: 'Black', hex: '#000000' }],
};

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

describe('Cart (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;
  let realtimeEmitter: { toUser: jest.Mock };

  async function bootstrap(
    userId = 'user-a',
    saleMap: Map<string, { campaignId: string; campaignName: string; percent: number; salePrice: number }> = new Map(),
  ) {
    prisma = createPrismaMock();
    realtimeEmitter = { toUser: jest.fn() };

    const created = await createTestApp({
      prisma,
      metadata: {
        controllers: [CartController],
        providers: [
          CartService,
          { provide: RealtimeEmitter, useValue: realtimeEmitter },
          {
            provide: SalePricingService,
            useValue: { resolveSaleForProducts: jest.fn().mockResolvedValue(saleMap) },
          },
        ],
      },
      configure: (builder) =>
        builder.overrideGuard(JwtAuthGuard).useValue(authGuardFor(userId)),
    });

    app = created.app;
  }

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('GET /cart', () => {
    it('trả giỏ của user, ảnh theo màu và cờ available', async () => {
      await bootstrap();
      prisma.cartItem.findMany.mockResolvedValue([
        {
          id: CART_ITEM_ID,
          userId: 'user-a',
          productId: PRODUCT_ID,
          color: 'Black',
          comboType: 'blazer',
          quantity: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
          product: {
            ...activeProduct,
            price: 750000,
            category: 'UPPER',
            garmentType: null,
            garmentUrl: 'https://img/default.png',
            images: [{ imageUrl: 'https://img/black.png', isMain: true, colorName: 'Black' }],
          },
        },
        {
          id: 'cart-2',
          userId: 'user-a',
          productId: OTHER_PRODUCT_ID,
          color: '',
          comboType: '',
          quantity: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          product: {
            id: OTHER_PRODUCT_ID,
            name: 'Quần tây',
            status: 'ARCHIVED',
            colors: null,
            price: 550000,
            category: 'LOWER',
            garmentType: null,
            garmentUrl: 'https://img/pants.png',
            images: [],
          },
        },
      ]);

      const res = await request(app.getHttpServer()).get('/api/cart').expect(200);

      expect(prisma.cartItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-a' }, orderBy: { createdAt: 'asc' } }),
      );
      expect(res.body.data.totalItems).toBe(3);
      expect(res.body.data.items[0]).toMatchObject({
        id: CART_ITEM_ID,
        color: 'Black',
        comboType: 'blazer',
        available: true,
        product: { price: 750000, imageUrl: 'https://img/black.png' },
      });
      expect(res.body.data.items[1]).toMatchObject({
        color: null,
        comboType: null,
        available: false,
        product: { sale: null, imageUrl: 'https://img/pants.png' },
      });
    });

    it('trả giá niêm yết và sale cho dòng đang giảm giá', async () => {
      await bootstrap('user-a', new Map([
        [PRODUCT_ID, { campaignId: 'campaign-a', campaignName: 'Sale Thu', percent: 30, salePrice: 700000 }],
      ]));
      prisma.cartItem.findMany.mockResolvedValue([
        {
          id: CART_ITEM_ID,
          userId: 'user-a',
          productId: PRODUCT_ID,
          color: 'Black',
          comboType: null,
          quantity: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          product: {
            ...activeProduct,
            price: 1000000,
            category: 'UPPER',
            garmentType: null,
            garmentUrl: 'https://img/default.png',
            images: [],
          },
        },
      ]);

      const res = await request(app.getHttpServer()).get('/api/cart').expect(200);

      expect(res.body.data.items[0].product).toMatchObject({
        price: 1000000,
        sale: { percent: 30, salePrice: 700000 },
      });
    });
  });

  describe('POST /cart/items', () => {
    it('trả 404 khi sản phẩm không tồn tại', async () => {
      await bootstrap();

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .send({ productId: PRODUCT_ID, quantity: 1 })
        .expect(404);
      expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
    });

    it('từ chối sản phẩm đã ngừng bán', async () => {
      await bootstrap();
      prisma.product.findUnique.mockResolvedValue({ ...activeProduct, status: 'ARCHIVED' });

      const res = await request(app.getHttpServer())
        .post('/api/cart/items')
        .send({ productId: PRODUCT_ID, quantity: 1 })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('PRODUCT_UNAVAILABLE');
      expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
    });

    it('từ chối màu không có trong danh sách màu của sản phẩm', async () => {
      await bootstrap();
      prisma.product.findUnique.mockResolvedValue(activeProduct);

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .send({ productId: PRODUCT_ID, quantity: 1, color: 'Purple' })
        .expect(400);
      expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
    });

    it('từ chối comboType lạ và field thừa như price', async () => {
      await bootstrap();
      prisma.product.findUnique.mockResolvedValue(activeProduct);

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .send({ productId: PRODUCT_ID, quantity: 1, comboType: 'vest' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/cart/items')
        .send({ productId: PRODUCT_ID, quantity: 1, price: 1 })
        .expect(400);
    });

    it('thêm món: upsert cộng dồn theo sản phẩm/màu/loại combo và báo thiết bị khác', async () => {
      await bootstrap();
      prisma.product.findUnique.mockResolvedValue(activeProduct);
      prisma.cartItem.upsert.mockResolvedValue({ id: CART_ITEM_ID, quantity: 3 });

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .send({ productId: PRODUCT_ID, quantity: 2, color: ' Black ', comboType: 'blazer' })
        .expect(200);

      const key = { userId: 'user-a', productId: PRODUCT_ID, color: 'Black', comboType: 'blazer' };
      expect(prisma.cartItem.upsert).toHaveBeenCalledWith({
        where: { userId_productId_color_comboType: key },
        create: { ...key, quantity: 2 },
        update: { quantity: { increment: 2 } },
      });
      expect(prisma.cartItem.update).not.toHaveBeenCalled();
      expect(realtimeEmitter.toUser).toHaveBeenCalledWith('user-a', 'cart:updated', expect.any(Object));
    });

    it('lưu tên màu chuẩn của sản phẩm để "black" và "Black" là cùng một dòng', async () => {
      await bootstrap();
      prisma.product.findUnique.mockResolvedValue(activeProduct);
      prisma.cartItem.upsert.mockResolvedValue({ id: CART_ITEM_ID, quantity: 1 });

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .send({ productId: PRODUCT_ID, quantity: 1, color: 'black' })
        .expect(200);

      expect(prisma.cartItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_productId_color_comboType: { userId: 'user-a', productId: PRODUCT_ID, color: 'Black', comboType: '' },
          },
        }),
      );
    });

    it('chặn số lượng một dòng ở mức 1000', async () => {
      await bootstrap();
      prisma.product.findUnique.mockResolvedValue(activeProduct);
      prisma.cartItem.findUnique.mockResolvedValue({ id: CART_ITEM_ID });
      prisma.cartItem.upsert.mockResolvedValue({ id: CART_ITEM_ID, quantity: 1200 });

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .send({ productId: PRODUCT_ID, quantity: 500 })
        .expect(200);

      expect(prisma.cartItem.update).toHaveBeenCalledWith({
        where: { id: CART_ITEM_ID },
        data: { quantity: 1000 },
      });
    });

    it('từ chối dòng mới khi giỏ đã đủ 50 dòng', async () => {
      await bootstrap();
      prisma.product.findUnique.mockResolvedValue(activeProduct);
      prisma.cartItem.count.mockResolvedValue(50);

      const res = await request(app.getHttpServer())
        .post('/api/cart/items')
        .send({ productId: PRODUCT_ID, quantity: 1 })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('CART_LINE_LIMIT');
      expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /cart/items/:id', () => {
    it('đặt số lượng cuối cùng, chỉ trên dòng của chính user', async () => {
      await bootstrap();
      prisma.cartItem.updateMany.mockResolvedValue({ count: 1 });

      await request(app.getHttpServer())
        .patch(`/api/cart/items/${CART_ITEM_ID}`)
        .send({ quantity: 4 })
        .expect(200);

      expect(prisma.cartItem.updateMany).toHaveBeenCalledWith({
        where: { id: CART_ITEM_ID, userId: 'user-a' },
        data: { quantity: 4 },
      });
    });

    it('trả 404 với dòng của user khác', async () => {
      await bootstrap('user-b');

      await request(app.getHttpServer())
        .patch(`/api/cart/items/${CART_ITEM_ID}`)
        .send({ quantity: 4 })
        .expect(404);
      expect(realtimeEmitter.toUser).not.toHaveBeenCalled();
    });

    it('từ chối số lượng 0 và id không phải UUID', async () => {
      await bootstrap();

      await request(app.getHttpServer())
        .patch(`/api/cart/items/${CART_ITEM_ID}`)
        .send({ quantity: 0 })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/api/cart/items/not-a-uuid')
        .send({ quantity: 1 })
        .expect(400);
      expect(prisma.cartItem.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('DELETE', () => {
    it('xoá một dòng của chính user', async () => {
      await bootstrap();
      prisma.cartItem.deleteMany.mockResolvedValue({ count: 1 });

      await request(app.getHttpServer()).delete(`/api/cart/items/${CART_ITEM_ID}`).expect(200);

      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { id: CART_ITEM_ID, userId: 'user-a' },
      });
    });

    it('trả 404 khi xoá dòng không thuộc user', async () => {
      await bootstrap('user-b');

      await request(app.getHttpServer()).delete(`/api/cart/items/${CART_ITEM_ID}`).expect(404);
    });

    it('xoá toàn bộ giỏ của user', async () => {
      await bootstrap();

      await request(app.getHttpServer()).delete('/api/cart').expect(200);

      expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-a' } });
    });
  });

  describe('POST /cart/merge', () => {
    it('món trùng lấy số lượng lớn hơn, không cộng, nên gửi lại vẫn cùng kết quả', async () => {
      await bootstrap();
      prisma.product.findMany.mockResolvedValue([activeProduct]);
      // findMany trong transaction (không include) thấy dòng đã có; getCart sau đó trả rỗng.
      prisma.cartItem.findMany.mockImplementation(async (args: { include?: unknown }) =>
        args?.include ? [] : [{ productId: PRODUCT_ID, color: 'Black', comboType: 'combo' }],
      );
      const payload = {
        items: [
          { productId: PRODUCT_ID, quantity: 1, color: 'Black', comboType: 'combo' },
          { productId: PRODUCT_ID, quantity: 3, color: 'Black', comboType: 'combo' },
        ],
      };

      for (let i = 0; i < 2; i++) {
        await request(app.getHttpServer()).post('/api/cart/merge').send(payload).expect(200);
      }

      const key = { productId: PRODUCT_ID, color: 'Black', comboType: 'combo' };
      for (const call of [1, 2]) {
        expect(prisma.cartItem.createMany).toHaveBeenNthCalledWith(call, {
          data: [{ userId: 'user-a', ...key, quantity: 3 }],
          skipDuplicates: true,
        });
        expect(prisma.cartItem.updateMany).toHaveBeenNthCalledWith(call, {
          where: { userId: 'user-a', ...key, quantity: { lt: 3 } },
          data: { quantity: 3 },
        });
      }
    });

    it('bỏ qua sản phẩm ngừng bán, sai màu và dòng vượt giới hạn, báo lại trong skipped', async () => {
      await bootstrap();
      prisma.product.findMany.mockResolvedValue([
        activeProduct,
        { id: OTHER_PRODUCT_ID, colors: null },
      ]);
      prisma.cartItem.findMany.mockResolvedValueOnce(
        Array.from({ length: 49 }, (_, i) => ({ productId: `existing-${i}`, color: '', comboType: '' })),
      );

      const res = await request(app.getHttpServer())
        .post('/api/cart/merge')
        .send({
          items: [
            { productId: '44444444-4444-4444-8444-444444444444', quantity: 1 },
            { productId: PRODUCT_ID, quantity: 1, color: 'Purple' },
            { productId: PRODUCT_ID, quantity: 2, color: 'Black' },
            { productId: OTHER_PRODUCT_ID, quantity: 1 },
          ],
        })
        .expect(200);

      expect(prisma.cartItem.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'user-a', productId: PRODUCT_ID, color: 'Black', comboType: '', quantity: 2 }],
        skipDuplicates: true,
      });
      expect(res.body.data.skipped).toEqual([
        { productId: '44444444-4444-4444-8444-444444444444', color: null, comboType: null, reason: 'PRODUCT_UNAVAILABLE' },
        { productId: PRODUCT_ID, color: 'Purple', comboType: null, reason: 'INVALID_COLOR' },
        { productId: OTHER_PRODUCT_ID, color: null, comboType: null, reason: 'CART_LINE_LIMIT' },
      ]);
    });

    it('gộp các dòng chỉ khác hoa thường của màu thành một dòng màu chuẩn', async () => {
      await bootstrap();
      prisma.product.findMany.mockResolvedValue([activeProduct]);

      await request(app.getHttpServer())
        .post('/api/cart/merge')
        .send({
          items: [
            { productId: PRODUCT_ID, quantity: 2, color: 'black' },
            { productId: PRODUCT_ID, quantity: 1, color: 'BLACK ' },
          ],
        })
        .expect(200);

      expect(prisma.cartItem.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'user-a', productId: PRODUCT_ID, color: 'Black', comboType: '', quantity: 2 }],
        skipDuplicates: true,
      });
    });

    it('giỏ khách rỗng thì chỉ trả giỏ hiện tại, không ghi gì', async () => {
      await bootstrap();

      const res = await request(app.getHttpServer())
        .post('/api/cart/merge')
        .send({ items: [] })
        .expect(200);

      expect(res.body.data).toMatchObject({ items: [], totalItems: 0, skipped: [] });
      expect(prisma.cartItem.createMany).not.toHaveBeenCalled();
      expect(realtimeEmitter.toUser).not.toHaveBeenCalled();
    });

    it('từ chối giỏ khách quá 50 dòng', async () => {
      await bootstrap();
      const items = Array.from({ length: 51 }, () => ({ productId: PRODUCT_ID, quantity: 1 }));

      await request(app.getHttpServer()).post('/api/cart/merge').send({ items }).expect(400);
    });
  });
});
