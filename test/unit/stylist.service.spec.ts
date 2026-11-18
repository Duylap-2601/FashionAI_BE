import { BadRequestException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StylistService } from '../../src/modules/stylist/stylist.service';
import { PrismaService } from '../../src/database/prisma.service';
import { QuotaService } from '../../src/common/services/quota.service';
import { ProductSuggestionService } from '../../src/modules/products/product-suggestion.service';
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
  let productSuggestions: ProductSuggestionService;
  let quota: any;

  // Catalog đang bán (getCatalog) và sản phẩm load lại khi ghép outfit (loadProducts).
  const catalogRows = [
    { id: 'shirt-1', name: 'Áo Sơ Mi Trắng', category: 'UPPER', garmentType: 'SHIRT', gender: 'FEMALE', color: 'Trắng', colors: [{ name: 'Trắng' }], material: 'kate', price: '550000' },
    { id: 'pants-1', name: 'Quần Tây Be', category: 'LOWER', garmentType: 'PANTS', gender: 'FEMALE', color: 'Be', colors: [], material: null, price: '550000' },
    { id: 'blazer-1', name: 'Blazer Đen', category: 'UPPER', garmentType: 'JACKET', gender: 'FEMALE', color: 'Đen', colors: [{ name: 'Đen' }], material: 'kaki', price: '750000' },
  ];
  const productRows = catalogRows.map((row) => ({
    ...row,
    garmentUrl: `https://cdn.example.com/${row.id}.png`,
    images: [],
    status: 'ACTIVE',
  }));
  const productFindMany = jest.fn((args: any) =>
    Promise.resolve(
      args?.where?.id?.in
        ? productRows.filter((row) => args.where.id.in.includes(row.id))
        : catalogRows,
    ),
  );

  const outfitJson = JSON.stringify({
    bodyType: 'Dáng người chữ V cân đối',
    skinTone: 'Da sáng, tông lạnh',
    personalColor: 'Winter - hợp màu lạnh',
    fitRecommendation: 'Slim-fit sẽ tôn dáng',
    colorSuggestions: ['Navy Blue', 'Trắng'],
    outfits: [
      {
        name: 'Công sở thanh lịch',
        reason: 'Hợp dịp họp',
        items: [{ code: 'P2', note: 'Ống suông' }, { code: 'P1', note: 'Sơ vin' }, { code: 'P3' }],
        extras: ['Giày cao gót nude'],
      },
      { name: 'Mã bịa', items: [{ code: 'P90' }, { code: 'P91' }] },
      { name: 'Không blazer', items: [{ code: 'P1' }, { code: 'P2' }] },
    ],
    stylingTips: 'Mẹo phối đồ',
    verdict: 'Rất phù hợp!',
    warnings: [],
  });

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
      product: { findUnique: jest.fn(), findMany: productFindMany },
      measurement: { findUnique: jest.fn().mockResolvedValue(null) },
      stylistResult: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
    };
    productSuggestions = new ProductSuggestionService(prisma as PrismaService);
    quota = {
      reserveQuota: jest.fn().mockResolvedValue(true),
      releaseQuota: jest.fn().mockResolvedValue(undefined),
    };

    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'GEMINI_API_KEY') return 'test-api-key';
        if (key === 'GEMINI_MODEL') return fallback ?? 'gemini-2.0-flash';
        return fallback;
      }),
    } as unknown as ConfigService;

    service = new StylistService(config, prisma as PrismaService, productSuggestions, quota as QuotaService);
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

    const svc = new StylistService(config, prisma, productSuggestions, quota);
    const dto = new StylistRequestDto();
    dto.garmentDescription = 'Vest navy';

    await expect(svc.analyzeAndAdvise('user-1', sampleFile, dto)).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      response: { error: 'GEMINI_NOT_CONFIGURED' },
    });
  });

  it('should throw BadRequestException when there is no image and no input at all', async () => {
    const dto = new StylistRequestDto();
    await expect(service.analyzeAndAdvise('user-1', undefined, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should reject an image sent without consent and never call Gemini', async () => {
    const dto = new StylistRequestDto();
    dto.occasion = 'Công sở';
    await expect(service.analyzeAndAdvise('user-1', sampleFile, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect((service as any).ai.models.generateContent).not.toHaveBeenCalled();
  });

  it('should run a successful analysis and save metadata + consume quota', async () => {
    const dto = new StylistRequestDto();
    dto.garmentDescription = 'Vest navy blue';
    dto.occasion = 'Họp quan trọng';
    dto.stylePreference = 'Lịch lãm';
    dto.budget = 'Dưới 2 triệu';
    dto.imageConsent = true;

    (service as any).ai.models.generateContent.mockResolvedValue({
      text: `\`\`\`json\n${validGeminiJson}\n\`\`\``,
    });

    prisma.stylistResult.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...data, id: 'result-1', product: null, createdAt: new Date('2026-01-01') }),
    );

    const result = await service.analyzeAndAdvise('user-1', sampleFile, dto);

    expect(prisma.stylistResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          // Ảnh không được lưu: chỉ giữ hash để tra cache.
          humanImageUrl: null,
          humanImageHash: expect.any(String),
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
            hasImage: true,
            imageConsentAt: expect.any(String),
          }),
          rawProviderResponse: expect.objectContaining({ text: expect.any(String) }),
        }),
      }),
    );
    expect(quota.reserveQuota).toHaveBeenCalledWith('user-1', undefined, 'STYLIST', undefined);
    expect(result.analysisResult.verdict).toBe('Rất phù hợp!');
    expect(result.fitAdvice).toBe('Nên may ôm nhẹ ở eo');
    expect(result.hasImage).toBe(true);
    expect(result.humanImageUrl).toBeNull();
  });

  it('should suggest catalog outfits without an image and drop invalid ones', async () => {
    const dto = new StylistRequestDto();
    dto.occasion = 'Họp quan trọng';

    const noImageJson = JSON.stringify({ ...JSON.parse(outfitJson), skinTone: null, personalColor: null, bodyType: null });
    (service as any).ai.models.generateContent.mockResolvedValue({ text: noImageJson });
    prisma.stylistResult.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...data, id: 'result-3', product: null, createdAt: new Date() }),
    );

    const result = await service.analyzeAndAdvise('user-1', undefined, dto);

    const request = (service as any).ai.models.generateContent.mock.calls[0][0];
    expect(request.contents[0].parts).toHaveLength(1);
    expect(request.contents[0].parts[0].text).toContain('P1 | Áo Sơ Mi Trắng');
    expect(request.config).toEqual({ responseMimeType: 'application/json' });

    expect(result.hasImage).toBe(false);
    expect(result.analysisResult.skinTone).toBeNull();
    expect(result.outfits.map((o) => o.name)).toEqual(['Công sở thanh lịch', 'Không blazer']);
    const [first] = result.outfits;
    expect(first.items.map((i) => [i.role, i.product.id])).toEqual([
      ['outer', 'blazer-1'],
      ['top', 'shirt-1'],
      ['bottom', 'pants-1'],
    ]);
    expect(first.totalPrice).toBe(1850000);
    expect(first.extras).toEqual(['Giày cao gót nude']);
    expect(result.analysisResult.outfitCombinations[0]).toBe(
      'Công sở thanh lịch: Quần Tây Be + Áo Sơ Mi Trắng + Blazer Đen',
    );
    // DB chỉ lưu productId, không lưu thông tin sản phẩm.
    const saved = prisma.stylistResult.create.mock.calls[0][0].data.analysisResult;
    expect(saved.outfits[0].items[0]).toEqual({ productId: 'pants-1', note: 'Ống suông' });
  });

  it('should only show items for the chosen gender plus unisex items to Gemini', async () => {
    const mixedRows = [
      ...catalogRows,
      { id: 'men-shirt-1', name: 'Áo Sơ Mi Nam', category: 'UPPER', garmentType: 'SHIRT', gender: 'MALE', color: 'Xanh', colors: [], material: null, price: '600000' },
      { id: 'tee-1', name: 'Áo Thun Unisex', category: 'UPPER', garmentType: 'SHIRT', gender: 'UNISEX', color: 'Trắng', colors: [], material: null, price: '300000' },
    ];
    prisma.product.findMany = jest.fn((args: any) => Promise.resolve(args?.where?.id?.in ? [] : mixedRows));
    const dto = new StylistRequestDto();
    dto.occasion = 'Phỏng vấn';
    dto.genderPreference = 'male';
    const emptyJson = JSON.stringify({ ...JSON.parse(outfitJson), outfits: [], skinTone: null, personalColor: null, bodyType: null });
    (service as any).ai.models.generateContent.mockResolvedValue({ text: emptyJson });
    prisma.stylistResult.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...data, id: 'result-men', product: null, createdAt: new Date() }),
    );

    await service.analyzeAndAdvise('user-1', undefined, dto);

    const prompt = (service as any).ai.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(prompt).toContain('P1 | Áo Sơ Mi Nam');
    expect(prompt).toContain('P2 | Áo Thun Unisex | Áo sơ mi/áo kiểu | lớp: Mặc trong | giới tính: Unisex');
    expect(prompt).not.toContain('Áo Sơ Mi Trắng');
    expect(prompt).toContain('chỉ gồm đồ nam và đồ unisex');
  });

  it('should keep only outfits containing the chosen product', async () => {
    const dto = new StylistRequestDto();
    dto.productId = 'blazer-1';
    prisma.product.findUnique.mockResolvedValue({ ...productRows[2], description: null });
    (service as any).ai.models.generateContent.mockResolvedValue({ text: outfitJson });
    prisma.stylistResult.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...data, id: 'result-4', product: productRows[2], createdAt: new Date() }),
    );

    const result = await service.analyzeAndAdvise('user-1', undefined, dto);

    const prompt = (service as any).ai.models.generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(prompt).toContain('mọi bộ đều phải chứa sản phẩm đang cân nhắc (mã P3)');
    expect(result.outfits.map((o) => o.name)).toEqual(['Công sở thanh lịch']);
  });

  it('should return hydrated outfits from cache without calling Gemini', async () => {
    const dto = new StylistRequestDto();
    dto.occasion = 'Công sở';
    prisma.stylistResult.findFirst.mockResolvedValue({
      id: 'cached-1',
      humanImageUrl: null,
      humanImageHash: null,
      product: null,
      fitAdvice: null,
      model: 'gemini-2.0-flash',
      createdAt: new Date(),
      analysisResult: {
        verdict: 'Ok',
        outfits: [{ name: 'Bộ cũ', reason: '', items: [{ productId: 'shirt-1', note: null }, { productId: 'pants-1', note: null }], extras: [] }],
      },
    });

    const result = await service.analyzeAndAdvise('user-1', undefined, dto);

    expect(result.isCached).toBe(true);
    expect(result.outfits[0].items.map((i) => i.product.name)).toEqual(['Áo Sơ Mi Trắng', 'Quần Tây Be']);
    expect((service as any).ai.models.generateContent).not.toHaveBeenCalled();
    expect(quota.reserveQuota).not.toHaveBeenCalled();
  });

  it('should change the cache key when body measurements change', async () => {
    const dto = new StylistRequestDto();
    dto.occasion = 'Công sở';

    const measurements = {
      userId: 'user-1',
      height: 160,
      weight: 50,
      chest: 84,
      waist: 66,
      hip: 90,
      shoulder: 38,
      updatedAt: new Date('2026-01-01'),
    };
    prisma.measurement.findUnique.mockResolvedValue(measurements);
    prisma.stylistResult.findFirst.mockResolvedValue(null);
    (service as any).ai.models.generateContent.mockResolvedValue({
      text: JSON.stringify({ ...JSON.parse(outfitJson), skinTone: null, personalColor: null, bodyType: null }),
    });
    prisma.stylistResult.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...data, id: 'result-m1', product: null, createdAt: new Date() }),
    );

    await service.analyzeAndAdvise('user-1', undefined, dto);
    const firstKey = prisma.stylistResult.findFirst.mock.calls[0][0].where.cacheKey;

    prisma.measurement.findUnique.mockResolvedValue({ ...measurements, waist: 72 });
    await service.analyzeAndAdvise('user-1', undefined, dto);
    const secondKey = prisma.stylistResult.findFirst.mock.calls[1][0].where.cacheKey;

    expect(secondKey).not.toBe(firstKey);
  });

  it('getUserHistory should not leak internal storage fields', async () => {
    prisma.stylistResult.findMany.mockResolvedValue([
      {
        id: 'r1',
        userId: 'user-1',
        cacheKey: 'cache-key',
        humanImageHash: 'image-hash',
        humanImageUrl: null,
        inputContext: { hasMeasurements: true },
        rawProviderResponse: { text: 'raw provider text' },
        expiresAt: new Date(),
        analysisResult: { outfits: [] },
      },
    ]);
    prisma.stylistResult.count.mockResolvedValue(1);

    const { items } = await service.getUserHistory('user-1');

    for (const field of ['userId', 'cacheKey', 'humanImageHash', 'inputContext', 'rawProviderResponse', 'expiresAt']) {
      expect(items[0]).not.toHaveProperty(field);
    }
    expect(items[0]).toMatchObject({ id: 'r1', hasImage: true });
  });

  it('getUserHistory should clamp invalid page/limit values', async () => {
    prisma.stylistResult.findMany.mockResolvedValue([]);
    prisma.stylistResult.count.mockResolvedValue(0);

    const { meta } = await service.getUserHistory('user-1', NaN, NaN);

    expect(meta).toMatchObject({ page: 1, limit: 20 });
    expect(prisma.stylistResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });

  it('TC-151: cache hết hạn không được dùng lại, phải tạo row mới', async () => {
    const dto = new StylistRequestDto();
    dto.occasion = 'Công sở';
    prisma.stylistResult.findFirst.mockResolvedValue(null);
    (service as any).ai.models.generateContent.mockResolvedValue({
      text: JSON.stringify({ ...JSON.parse(outfitJson), skinTone: null, personalColor: null, bodyType: null }),
    });
    prisma.stylistResult.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...data, id: 'fresh', product: null, createdAt: new Date() }),
    );

    const result = await service.analyzeAndAdvise('user-1', undefined, dto);

    const where = prisma.stylistResult.findFirst.mock.calls[0][0].where;
    // Lookup chỉ nhận row chưa hết hạn.
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
    expect(result.isCached).toBe(false);
    expect((service as any).ai.models.generateContent).toHaveBeenCalledTimes(1);
    expect(prisma.stylistResult.create).toHaveBeenCalledTimes(1);
  });

  it('TC-159: repair đúng một lần rồi trả kết quả; vẫn hỏng thì 502 và không gọi lần 3', async () => {
    const dto = new StylistRequestDto();
    dto.occasion = 'Công sở';
    prisma.stylistResult.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...data, id: 'repair-ok', product: null, createdAt: new Date() }),
    );
    const generate = (service as any).ai.models.generateContent;

    generate
      .mockResolvedValueOnce({ text: 'không phải json' })
      .mockResolvedValueOnce({ text: outfitJson });
    const ok = await service.analyzeAndAdvise('user-1', undefined, dto);

    expect(generate).toHaveBeenCalledTimes(2);
    const repairPrompt = generate.mock.calls[1][0].contents[0].parts[0].text;
    expect(repairPrompt).toContain('SỬA LỖI ĐỊNH DẠNG');
    expect(repairPrompt).toContain('did not contain JSON');
    expect(repairPrompt).toContain('không phải json');
    expect(ok.isCached).toBe(false);

    generate.mockReset();
    generate.mockResolvedValue({ text: 'vẫn hỏng' });
    prisma.stylistResult.create.mockClear();

    await expect(service.analyzeAndAdvise('user-1', undefined, dto)).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      response: { error: 'GEMINI_INVALID_RESPONSE' },
    });
    // Lượt đầu + 1 repair, không có lần thứ 3.
    expect(generate).toHaveBeenCalledTimes(2);
    expect(prisma.stylistResult.create).not.toHaveBeenCalled();
  });

  it('TC-160: lỗi provider map 401 INVALID_API_KEY và 500 GEMINI_ERROR', async () => {
    const dto = new StylistRequestDto();
    dto.occasion = 'Công sở';
    const generate = (service as any).ai.models.generateContent;

    generate.mockReset();
    generate.mockRejectedValue(new Error('401 API key not valid'));
    await expect(service.analyzeAndAdvise('user-1', undefined, dto)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: { error: 'INVALID_API_KEY' },
    });

    generate.mockReset();
    generate.mockRejectedValue(new Error('connection reset by peer'));
    await expect(service.analyzeAndAdvise('user-1', undefined, dto)).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      response: { error: 'GEMINI_ERROR' },
    });
    // Không lưu row khi provider lỗi.
    expect(prisma.stylistResult.create).not.toHaveBeenCalled();
  });

  it('TC-163/TC-164: detail/delete của người khác trả 404, delete của chính mình xoá row', async () => {
    prisma.stylistResult.findFirst.mockResolvedValue(null);
    await expect(service.getHistoryItem('user-a', 'row-b')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
    await expect(service.deleteHistoryItem('user-a', 'row-b')).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
    expect(prisma.stylistResult.delete).not.toHaveBeenCalled();

    prisma.stylistResult.findFirst.mockResolvedValue({
      id: 'row-a',
      humanImageHash: null,
      humanImageUrl: null,
      analysisResult: { outfits: [] },
      product: null,
    });
    prisma.stylistResult.delete.mockResolvedValue({ id: 'row-a' });

    await expect(service.deleteHistoryItem('user-a', 'row-a')).resolves.toEqual({ id: 'row-a' });
    expect(prisma.stylistResult.delete).toHaveBeenCalledWith({ where: { id: 'row-a' } });
    // Ownership luôn lọc theo userId, không chỉ id.
    expect(prisma.stylistResult.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 'row-a', userId: 'user-a' } }),
    );
  });

  it('TC-161: phân trang trả đúng trang mới nhất và kẹp limit', async () => {
    prisma.stylistResult.findMany.mockResolvedValue([{ id: 'r1', analysisResult: { outfits: [] } }]);
    prisma.stylistResult.count.mockResolvedValue(25);

    const { meta } = await service.getUserHistory('user-1', 2, 5);

    expect(meta).toEqual({ total: 25, page: 2, limit: 5, totalPages: 5 });
    expect(prisma.stylistResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5, orderBy: { createdAt: 'desc' }, where: { userId: 'user-1' } }),
    );

    await service.getUserHistory('user-1', 1, 1000);
    expect(prisma.stylistResult.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it('getUserHistory should attach hydrated outfits to every item with one product query', async () => {
    prisma.stylistResult.findMany.mockResolvedValue([
      { id: 'r1', humanImageUrl: 'https://old/photo.png', humanImageHash: null, analysisResult: { outfits: [{ name: 'A', items: [{ productId: 'shirt-1' }, { productId: 'pants-1' }] }] } },
      { id: 'r2', humanImageUrl: null, humanImageHash: null, analysisResult: { outfitCombinations: ['Bộ phối cũ dạng chữ'] } },
    ]);
    prisma.stylistResult.count.mockResolvedValue(2);

    const { items } = await service.getUserHistory('user-1');

    expect(items[0].outfits[0].items).toHaveLength(2);
    expect(items[0].hasImage).toBe(true);
    expect(items[1].outfits).toEqual([]);
    expect(items[1].hasImage).toBe(false);
    expect(productFindMany).toHaveBeenCalledTimes(1);
  });

  it('should include product context and fetch product when productId is provided', async () => {
    const dto = new StylistRequestDto();
    dto.productId = 'blazer-1';

    prisma.product.findUnique.mockResolvedValue({ ...productRows[2], description: null });
    dto.imageConsent = true;

    (service as any).ai.models.generateContent.mockResolvedValue({ text: validGeminiJson });
    prisma.stylistResult.create.mockResolvedValue({
      id: 'result-2',
      product: { id: 'blazer-1', name: 'Blazer Đen' },
      createdAt: new Date(),
    });

    const result = await service.analyzeAndAdvise('user-1', sampleFile, dto);

    expect(prisma.product.findUnique).toHaveBeenCalledWith({
      where: { id: 'blazer-1' },
      include: { images: true },
    });
    const createCall = prisma.stylistResult.create.mock.calls[0][0];
    expect(createCall.data.productId).toBe('blazer-1');
    expect(result.product?.name).toBe('Blazer Đen');
  });

  it('should throw NotFoundException for unknown product', async () => {
    const dto = new StylistRequestDto();
    dto.productId = 'missing-product';
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(service.analyzeAndAdvise('user-1', undefined, dto)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('should reject an inactive anchor product and release the reserved quota', async () => {
    const dto = new StylistRequestDto();
    dto.productId = 'blazer-1';
    prisma.product.findUnique.mockResolvedValue({ ...productRows[2], status: 'ARCHIVED' });

    await expect(service.analyzeAndAdvise('user-1', undefined, dto)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
    expect(quota.releaseQuota).toHaveBeenCalledWith('user-1', 'STYLIST');
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
    expect(result.colorSuggestions).toEqual([
      { name: 'Navy', hex: null },
      { name: 'Trắng', hex: null },
    ]);
    expect(result.outfitCombinations[0]).toContain('Sơ mi trắng');
    expect(result.bodyType).toBe('Dáng chữ V');
  });

  it('validateResult should keep valid color hex codes and drop malformed ones', () => {
    const result = service.validateResult({
      bodyType: 'Dáng chữ A',
      skinTone: 'Sáng',
      personalColor: 'Mùa Thu',
      fitRecommendation: 'Ôm nhẹ',
      colorSuggestions: [{ name: 'Be', hex: '#e8dcc8' }, { name: 'Đỏ', hex: 'red' }, { hex: '#000000' }, 'Navy'],
      stylingTips: '- Mẹo',
      verdict: 'Hợp',
    });
    expect(result.colorSuggestions).toEqual([
      { name: 'Be', hex: '#E8DCC8' },
      { name: 'Đỏ', hex: null },
      { name: 'Navy', hex: null },
    ]);
  });

  it('should map Gemini quota/429 errors to 429 HttpException', async () => {
    const dto = new StylistRequestDto();
    dto.garmentDescription = 'Vest';
    dto.imageConsent = true;
    (service as any).ai.models.generateContent.mockRejectedValue(
      new Error('429 RESOURCE_EXHAUSTED'),
    );

    await expect(service.analyzeAndAdvise('user-1', sampleFile, dto)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });
});
