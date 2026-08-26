import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StylistService } from '../../src/modules/stylist/stylist.service';
import { PrismaService } from '../../src/database/prisma.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { QuotaService } from '../../src/common/services/quota.service';
import { StylistRequestDto } from '../../src/modules/stylist/dto/stylist-request.dto';

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest.fn(),
    },
  })),
}));

describe('StylistService', () => {
  let service: StylistService;
  let prisma: any;
  let storage: any;
  let quota: any;

  const sampleFile = {
    buffer: Buffer.from('fake-image-bytes'),
    mimetype: 'image/png',
    size: 1024,
  } as Express.Multer.File;

  const validGeminiJson = JSON.stringify({
    bodyType: 'Dáng người chữ V cân đối',
    skinTone: 'Da sáng, tông lạnh',
    personalColor: 'Winter - hợp màu lạnh',
    fitRecommendation: 'Slim-fit sẽ tôn dáng',
    fitAdvice: 'Nên may ôm nhẹ ở eo',
    productCompatibilityScore: 87,
    colorSuggestions: ['Navy Blue', 'Charcoal', 'Đen'],
    outfitCombinations: ['Outfit 1', 'Outfit 2'],
    stylingTips: 'Mẹo phối đồ',
    verdict: 'Rất phù hợp!',
  });

  beforeEach(() => {
    prisma = {
      product: { findUnique: jest.fn() },
      measurement: { findUnique: jest.fn().mockResolvedValue(null) },
      stylistResult: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
    };
    storage = { uploadImage: jest.fn().mockResolvedValue('https://cdn.example.com/stylist.png') };
    quota = { consumeQuota: jest.fn().mockResolvedValue(1) };

    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'GEMINI_API_KEY') return 'test-api-key';
        if (key === 'GEMINI_MODEL') return fallback ?? 'gemini-2.0-flash';
        return fallback;
      }),
    } as unknown as ConfigService;

    service = new StylistService(config, prisma as PrismaService, storage as StorageService, quota as QuotaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw GEMINI_NOT_CONFIGURED when API key is missing', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'GEMINI_API_KEY') return undefined;
        if (key === 'GEMINI_MODEL') return fallback ?? 'gemini-2.0-flash';
        return fallback;
      }),
    } as unknown as ConfigService;

    const svc = new StylistService(config, prisma, storage, quota);
    const dto = new StylistRequestDto();
    dto.garmentDescription = 'Vest navy';

    await expect(svc.analyzeAndAdvise('user-1', sampleFile, dto)).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: { error: 'GEMINI_NOT_CONFIGURED' },
    });
  });

  it('should throw BadRequestException when neither productId nor garmentDescription is provided', async () => {
    const dto = new StylistRequestDto();
    await expect(service.analyzeAndAdvise('user-1', sampleFile, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should run a successful analysis and save metadata + consume quota', async () => {
    const dto = new StylistRequestDto();
    dto.garmentDescription = 'Vest navy blue';
    dto.occasion = 'Họp quan trọng';
    dto.stylePreference = 'Lịch lãm';
    dto.budget = 'Dưới 2 triệu';

    (service as any).ai.models.generateContent.mockResolvedValue({
      text: `\`\`\`json\n${validGeminiJson}\n\`\`\``,
    });

    prisma.stylistResult.create.mockResolvedValue({
      id: 'result-1',
      product: null,
      createdAt: new Date('2026-01-01'),
    });

    const result = await service.analyzeAndAdvise('user-1', sampleFile, dto);

    expect(storage.uploadImage).toHaveBeenCalled();
    expect(prisma.stylistResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          garmentDescription: 'Vest navy blue',
          fitAdvice: 'Nên may ôm nhẹ ở eo',
          model: 'gemini-2.0-flash',
          analysisResult: expect.objectContaining({
            productCompatibilityScore: 87,
            fitAdvice: 'Nên may ôm nhẹ ở eo',
          }),
          inputContext: expect.objectContaining({
            stylePreference: 'Lịch lãm',
            budget: 'Dưới 2 triệu',
            hasMeasurements: false,
          }),
          rawProviderResponse: expect.objectContaining({ text: expect.any(String) }),
        }),
      }),
    );
    expect(quota.consumeQuota).toHaveBeenCalledWith('user-1', 'STYLIST');
    expect(result.analysisResult.verdict).toBe('Rất phù hợp!');
    expect(result.fitAdvice).toBe('Nên may ôm nhẹ ở eo');
  });

  it('should include product context and fetch product when productId is provided', async () => {
    const dto = new StylistRequestDto();
    dto.productId = 'product-1';

    prisma.product.findUnique.mockResolvedValue({
      id: 'product-1',
      name: 'Áo Sơ Mi Trắng',
      description: 'Sơ mi trắng premium',
      category: 'UPPER',
      color: 'Trắng',
      price: 350000,
      garmentUrl: 'https://example.com/shirt.jpg',
      images: [],
    });

    (service as any).ai.models.generateContent.mockResolvedValue({ text: validGeminiJson });
    prisma.stylistResult.create.mockResolvedValue({
      id: 'result-2',
      product: { id: 'product-1', name: 'Áo Sơ Mi Trắng' },
      createdAt: new Date(),
    });

    const result = await service.analyzeAndAdvise('user-1', sampleFile, dto);

    expect(prisma.product.findUnique).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      include: { images: true },
    });
    const createCall = prisma.stylistResult.create.mock.calls[0][0];
    expect(createCall.data.productId).toBe('product-1');
    expect(result.product?.name).toBe('Áo Sơ Mi Trắng');
  });

  it('should throw NotFoundException for unknown product', async () => {
    const dto = new StylistRequestDto();
    dto.productId = 'missing-product';
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(service.analyzeAndAdvise('user-1', sampleFile, dto)).rejects.toThrow(
      HttpException,
    );
  });

  it('parseRawResponse should strip markdown fences', () => {
    const raw = service.parseRawResponse('```json\n{"a": 1}\n```');
    expect(raw).toEqual({ a: 1 });
  });

  it('parseRawResponse should throw when no JSON present', () => {
    expect(() => service.parseRawResponse('Không có JSON ở đây')).toThrow(
      /did not contain JSON/,
    );
  });

  it('validateResult should throw when a required field is missing', () => {
    const raw: Record<string, unknown> = {
      bodyType: 'Dáng chữ V',
      skinTone: 'Sáng',
      personalColor: 'Winter',
    };
    expect(() => service.validateResult(raw)).toThrow(/thiếu field/);
  });

  it('validateResult should clamp score and normalize object arrays', () => {
    const raw: Record<string, unknown> = {
      bodyType: ' Dáng chữ V ',
      skinTone: 'Sáng',
      personalColor: 'Winter',
      fitRecommendation: 'Slim-fit',
      productCompatibilityScore: 150,
      colorSuggestions: [{ name: 'Navy' }, 'Trắng'],
      outfitCombinations: [{ type: 'Áo', name: 'Sơ mi trắng' }],
      stylingTips: 'Mẹo',
      verdict: 'Phù hợp',
    };
    const result = service.validateResult(raw);
    expect(result.productCompatibilityScore).toBe(100);
    expect(result.colorSuggestions).toEqual(['Navy', 'Trắng']);
    expect(result.outfitCombinations[0]).toContain('Sơ mi trắng');
    expect(result.bodyType).toBe('Dáng chữ V');
  });

  it('should map Gemini quota/429 errors to 429 HttpException', async () => {
    const dto = new StylistRequestDto();
    dto.garmentDescription = 'Vest';
    (service as any).ai.models.generateContent.mockRejectedValue(
      new Error('429 RESOURCE_EXHAUSTED'),
    );

    await expect(service.analyzeAndAdvise('user-1', sampleFile, dto)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });
});
