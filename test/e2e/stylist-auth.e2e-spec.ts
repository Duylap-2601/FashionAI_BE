import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import { StylistController } from '../../src/modules/stylist/stylist.controller';
import { StylistService } from '../../src/modules/stylist/stylist.service';
import { ProductSuggestionService } from '../../src/modules/products/product-suggestion.service';
import { QuotaService } from '../../src/common/services/quota.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { TokenService } from '../../src/modules/auth/token.service';
import { RateLimitGuard } from '../../src/common/guards/rate-limit.guard';
import { createPrismaMock, createRedisMock, createTestApp } from './helpers/test-app';

const JWT_ACCESS_SECRET = 'e2e-access-secret';

describe('Stylist auth (e2e) — TC-175', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // JwtAuthGuard/JwtStrategy thật (không override) để khẳng định middleware chặn request.
    const created = await createTestApp({
      prisma: createPrismaMock(),
      redis: createRedisMock(),
      metadata: {
        imports: [
          PassportModule,
          JwtModule.register({}),
          ConfigModule.forRoot({
            load: [
              () => ({
                NODE_ENV: 'test',
                JWT_ACCESS_SECRET,
                JWT_REFRESH_SECRET: 'e2e-refresh-secret',
              }),
            ],
          }),
        ],
        controllers: [StylistController],
        providers: [StylistService, ProductSuggestionService, QuotaService, JwtStrategy, TokenService],
      },
      configure: (builder) =>
        builder.overrideGuard(RateLimitGuard).useValue({ canActivate: () => true }),
    });
    app = created.app;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('POST /api/stylist/analyze không token → 401 UNAUTHORIZED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/stylist/analyze')
      .field('occasion', 'Công sở')
      .expect(401);

    expect(res.body).toMatchObject({ success: false });
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/stylist/history không token → 401, không lộ dữ liệu', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/stylist/history')
      .expect(401);

    expect(res.body).toMatchObject({ success: false });
    expect(res.body).not.toHaveProperty('data');
  });

  it('token sai chữ ký → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/stylist/history')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
  });

  it('guard được khai báo trên controller: JwtAuthGuard là guard thật của route', () => {
    const guards = Reflect.getMetadata('__guards__', StylistController) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });
});
