import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { GarmentCategory, UserTier } from '@prisma/client';
import { TryOnController } from '../../src/modules/try-on/try-on.controller';
import { TryOnService } from '../../src/modules/try-on/try-on.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { QuotaService } from '../../src/common/services/quota.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { QuotaGuard } from '../../src/common/guards/quota.guard';
import { RateLimitGuard } from '../../src/common/guards/rate-limit.guard';
import {
  createPrismaMock,
  createRedisMock,
  createTestApp,
  PrismaMock,
} from './helpers/test-app';

/** Ảnh PNG 1x1 hợp lệ để multer/FileValidationPipe chấp nhận. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

function authGuardFor(userId: string) {
  return {
    canActivate: (context: any) => {
      context.switchToHttp().getRequest().user = {
        id: userId,
        email: `${userId}@test.com`,
        tier: UserTier.MEMBER,
      };
      return true;
    },
  };
}

describe('Try-On cache scoping (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;
  let redis: ReturnType<typeof createRedisMock>;

  async function bootstrap(userId: string) {
    prisma = createPrismaMock();
    redis = createRedisMock();

    const created = await createTestApp({
      prisma,
      redis,
      metadata: {
        imports: [
          ConfigModule.forRoot({
            load: [() => ({ AI_TRYON_PROVIDER: 'mock', NODE_ENV: 'test' })],
          }),
        ],
        controllers: [TryOnController],
        providers: [
          TryOnService,
          QuotaService,
          {
            provide: StorageService,
            useValue: {
              uploadImage: jest
                .fn()
                .mockResolvedValue('https://cdn.test/result.png'),
            },
          },
        ],
      },
      configure: (builder) =>
        builder
          .overrideGuard(JwtAuthGuard)
          .useValue(authGuardFor(userId))
          .overrideGuard(QuotaGuard)
          .useValue({ canActivate: () => true })
          .overrideGuard(RateLimitGuard)
          .useValue({ canActivate: () => true }),
    });

    app = created.app;
  }

  afterEach(async () => {
    if (app) await app.close();
  });

  it('không dùng kết quả cache của user khác cho cùng cặp ảnh', async () => {
    await bootstrap('user-b');

    // Mô phỏng DB: chỉ có bản ghi của user-a. Query phải lọc theo userId nên
    // user-b không được nhận lại resultUrl đó.
    prisma.tryOnResult.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.userId === 'user-a' ? { id: 'cached-a' } : null),
    );
    prisma.tryOnResult.create.mockResolvedValue({
      id: 'new-b',
      createdAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .post('/api/try-on')
      .attach('humanImage', PNG_1X1, { filename: 'h.png', contentType: 'image/png' })
      .attach('garmentImage', PNG_1X1, { filename: 'g.png', contentType: 'image/png' })
      .field('garmentCategory', GarmentCategory.UPPER)
      .expect(200);

    expect(res.body.data.isCached).toBe(false);
    expect(res.body.data.id).toBe('new-b');

    // Cache lookup phải bị giới hạn theo userId của người gọi.
    expect(prisma.tryOnResult.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-b' }),
      }),
    );
  });

  it('trả về cache của chính user và không tính quota', async () => {
    await bootstrap('user-a');

    prisma.tryOnResult.findFirst.mockResolvedValue({
      id: 'cached-a',
      resultUrl: 'https://cdn.test/cached.png',
      category: GarmentCategory.UPPER,
      createdAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .post('/api/try-on')
      .attach('humanImage', PNG_1X1, { filename: 'h.png', contentType: 'image/png' })
      .attach('garmentImage', PNG_1X1, { filename: 'g.png', contentType: 'image/png' })
      .expect(200);

    expect(res.body.data).toMatchObject({
      id: 'cached-a',
      isCached: true,
    });
    // Cache hit không được tạo bản ghi mới và không tăng counter quota.
    expect(prisma.tryOnResult.create).not.toHaveBeenCalled();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('ghi cacheKey và expiresAt khi tạo kết quả mới', async () => {
    await bootstrap('user-a');

    prisma.tryOnResult.findFirst.mockResolvedValue(null);
    prisma.tryOnResult.create.mockResolvedValue({
      id: 'new-1',
      createdAt: new Date(),
    });

    await request(app.getHttpServer())
      .post('/api/try-on')
      .attach('humanImage', PNG_1X1, { filename: 'h.png', contentType: 'image/png' })
      .attach('garmentImage', PNG_1X1, { filename: 'g.png', contentType: 'image/png' })
      .expect(200);

    const createArg = prisma.tryOnResult.create.mock.calls[0][0];
    expect(createArg.data.cacheKey).toMatch(/^user-a:[a-f0-9]{64}:[a-f0-9]{64}:UPPER$/);
    expect(createArg.data.expiresAt).toBeInstanceOf(Date);
    expect(createArg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('yêu cầu humanImage', async () => {
    await bootstrap('user-a');

    await request(app.getHttpServer())
      .post('/api/try-on')
      .attach('garmentImage', PNG_1X1, { filename: 'g.png', contentType: 'image/png' })
      .expect(400);
  });

  it('yêu cầu productId hoặc garmentImage', async () => {
    await bootstrap('user-a');

    await request(app.getHttpServer())
      .post('/api/try-on')
      .attach('humanImage', PNG_1X1, { filename: 'h.png', contentType: 'image/png' })
      .expect(400);
  });

  it('DELETE /try-on/history/all xóa toàn bộ lịch sử của user', async () => {
    await bootstrap('user-a');

    prisma.tryOnResult.deleteMany.mockResolvedValue({ count: 3 });

    const res = await request(app.getHttpServer())
      .delete('/api/try-on/history/all')
      .expect(200);

    expect(res.body.data).toEqual({ deleted: 3 });
    expect(prisma.tryOnResult.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-a' },
    });
  });
});
