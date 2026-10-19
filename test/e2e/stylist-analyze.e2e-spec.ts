import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { UserTier } from '@prisma/client';
import { StylistController } from '../../src/modules/stylist/stylist.controller';
import { StylistService } from '../../src/modules/stylist/stylist.service';
import { ProductSuggestionService } from '../../src/modules/products/product-suggestion.service';
import { QuotaService } from '../../src/common/services/quota.service';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { QuotaGuard } from '../../src/common/guards/quota.guard';
import { RateLimitGuard } from '../../src/common/guards/rate-limit.guard';
import { createPrismaMock, createTestApp, PrismaMock } from './helpers/test-app';

const generateContent = jest.fn();
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent } })),
}));

/** Ảnh PNG 1x1 hợp lệ để multer/FileValidationPipe chấp nhận. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

const catalogRows = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Áo Sơ Mi Trắng', category: 'UPPER', garmentType: 'SHIRT', color: 'Trắng', colors: [{ name: 'Trắng' }], material: 'kate', price: '550000' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Chân Váy Be', category: 'LOWER', garmentType: 'SKIRT', color: 'Be', colors: [{ name: 'Be' }], material: null, price: '550000' },
];

const geminiResult = {
  bodyType: null,
  skinTone: null,
  personalColor: null,
  fitRecommendation: 'Phom suông nhẹ',
  colorSuggestions: ['Trắng', 'Be'],
  outfits: [
    {
      name: 'Công sở nhẹ nhàng',
      reason: 'Hợp dịp họp, tông sáng',
      items: [{ code: 'P1', note: 'Sơ vin' }, { code: 'P2' }],
      extras: ['Giày mũi nhọn nude'],
    },
  ],
  stylingTips: 'Thêm thắt lưng mảnh',
  verdict: 'Phù hợp đi làm',
  warnings: [],
};

describe('POST /api/stylist/analyze (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;

  beforeEach(async () => {
    generateContent.mockReset();
    generateContent.mockResolvedValue({ text: JSON.stringify(geminiResult) });

    prisma = createPrismaMock();
    prisma.product.findMany.mockImplementation((args: any) =>
      Promise.resolve(
        args?.where?.id?.in
          ? catalogRows
              .filter((row) => args.where.id.in.includes(row.id))
              .map((row) => ({ ...row, garmentUrl: `https://cdn.test/${row.id}.png`, images: [], status: 'ACTIVE' }))
          : catalogRows,
      ),
    );
    prisma.stylistResult.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...data, id: 'result-1', product: null, createdAt: new Date() }),
    );

    const created = await createTestApp({
      prisma,
      metadata: {
        imports: [ConfigModule.forRoot({ load: [() => ({ GEMINI_API_KEY: 'test-key', NODE_ENV: 'test' })] })],
        controllers: [StylistController],
        providers: [StylistService, ProductSuggestionService, QuotaService],
      },
      configure: (builder) =>
        builder
          .overrideGuard(JwtAuthGuard)
          .useValue({
            canActivate: (context: any) => {
              context.switchToHttp().getRequest().user = { id: 'user-1', email: 'u@test.com', tier: UserTier.MEMBER };
              return true;
            },
          })
          .overrideGuard(QuotaGuard)
          .useValue({ canActivate: () => true })
          .overrideGuard(RateLimitGuard)
          .useValue({ canActivate: () => true }),
    });
    app = created.app;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('gợi ý outfit từ catalog khi không gửi ảnh', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/stylist/analyze')
      .field('occasion', 'Họp quan trọng')
      .expect(200);

    expect(res.body.data).toMatchObject({ hasImage: false, humanImageUrl: null, isCached: false });
    expect(res.body.data.outfits).toEqual([
      {
        name: 'Công sở nhẹ nhàng',
        reason: 'Hợp dịp họp, tông sáng',
        extras: ['Giày mũi nhọn nude'],
        totalPrice: 1100000,
        items: [
          expect.objectContaining({ role: 'top', note: 'Sơ vin', product: expect.objectContaining({ id: catalogRows[0].id, price: 550000, color: 'Trắng', available: true }) }),
          expect.objectContaining({ role: 'bottom', product: expect.objectContaining({ id: catalogRows[1].id }) }),
        ],
      },
    ]);
    // Gemini chỉ nhận prompt chữ, không có ảnh.
    expect(generateContent.mock.calls[0][0].contents[0].parts).toHaveLength(1);
  });

  it('từ chối ảnh gửi kèm mà không có xác nhận đồng ý', async () => {
    for (const consent of [undefined, 'false']) {
      const req = request(app.getHttpServer())
        .post('/api/stylist/analyze')
        .attach('humanImage', PNG_1X1, { filename: 'me.png', contentType: 'image/png' })
        .field('occasion', 'Công sở');
      if (consent) req.field('imageConsent', consent);
      await req.expect(400);
    }
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('phân tích ảnh có đồng ý nhưng không lưu ảnh', async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({ ...geminiResult, bodyType: 'Dáng chữ A', skinTone: 'Da sáng', personalColor: 'Mùa hè' }),
    });

    const res = await request(app.getHttpServer())
      .post('/api/stylist/analyze')
      .attach('humanImage', PNG_1X1, { filename: 'me.png', contentType: 'image/png' })
      .field('imageConsent', 'true')
      .expect(200);

    expect(res.body.data).toMatchObject({ hasImage: true, humanImageUrl: null });
    expect(generateContent.mock.calls[0][0].contents[0].parts[1].inlineData.mimeType).toBe('image/png');
    const saved = prisma.stylistResult.create.mock.calls[0][0].data;
    expect(saved.humanImageUrl).toBeNull();
    expect(saved.humanImageHash).toEqual(expect.any(String));
  });

  it('báo lỗi khi không có thông tin nào để tư vấn', async () => {
    await request(app.getHttpServer()).post('/api/stylist/analyze').field('budget', '1 triệu').expect(400);
    expect(generateContent).not.toHaveBeenCalled();
  });
});
