import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { Product, StylistResult } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { QuotaService } from '../../common/services/quota.service';
import {
  OutfitSuggestion,
  ProductSuggestionService,
  StoredOutfit,
  StylingCatalog,
  collectProductIds,
} from '../products/product-suggestion.service';
import { StylistRequestDto } from './dto/stylist-request.dto';
import * as crypto from 'crypto';

// Tăng khi đổi prompt/cấu trúc kết quả để cache cũ (khác cấu trúc) không bị trả lại.
const STYLIST_PROMPT_VERSION = 'v4-color-hex';

interface ProductContext {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  color?: string | null;
  price?: number | null;
  imageUrl?: string | null;
}

interface MeasurementContext {
  height?: number | null;
  weight?: number | null;
  chest?: number | null;
  waist?: number | null;
  hip?: number | null;
  shoulder?: number | null;
}

interface CatalogPromptContext {
  catalog: StylingCatalog;
  /** Mã của sản phẩm người dùng chọn nếu nó đang bán; null thì không ép outfit phải chứa nó. */
  anchorCode: string | null;
}

export interface StylistValidationContext {
  /** Mặc định true. Không có ảnh thì các nhận xét về da/màu cá nhân được phép null. */
  hasImage?: boolean;
  catalog?: StylingCatalog | null;
  anchorProductId?: string | null;
}

/** Màu gợi ý kèm mã hex để client hiện ô màu; hex null khi AI không trả mã hợp lệ. */
export interface ColorSuggestion {
  name: string;
  hex: string | null;
}

export interface ParsedStylistResult {
  bodyType: string | null;
  skinTone: string | null;
  personalColor: string | null;
  fitRecommendation: string;
  fitAdvice?: string | null;
  productCompatibilityScore?: number | null;
  colorSuggestions: ColorSuggestion[];
  /** Bộ phối từ catalog (chỉ lưu productId); response trả bản đã ghép sản phẩm ở `outfits`. */
  outfits: StoredOutfit[];
  /** Mô tả chữ của outfits, giữ cho client/lịch sử cũ. */
  outfitCombinations: string[];
  stylingTips: string;
  verdict: string;
  warnings: string[];
}

type StylistRecord = StylistResult & { product: Product | null };

@Injectable()
export class StylistService {
  private readonly logger = new Logger(StylistService.name);
  private readonly ai: GoogleGenAI;
  private readonly MODEL: string;
  private readonly hasApiKey: boolean;
  private readonly CACHE_TTL_MS: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly productSuggestions: ProductSuggestionService,
    private readonly quotaService: QuotaService,
  ) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    this.hasApiKey = Boolean(apiKey);
    if (!this.hasApiKey) {
      this.logger.warn('GEMINI_API_KEY is not configured. AI Stylist will be unavailable.');
    }

    this.ai = new GoogleGenAI({ apiKey: apiKey ?? '' });
    this.MODEL = this.config.get<string>('GEMINI_MODEL', 'gemini-2.0-flash');
    this.CACHE_TTL_MS =
      parseInt(this.config.get<string>('STYLIST_CACHE_TTL_DAYS') ?? '30', 10) *
      24 *
      60 *
      60 *
      1000;
  }

  private computeHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  private buildCacheKey(
    userId: string,
    humanImageHash: string | null,
    catalogFingerprint: string,
    dto: StylistRequestDto,
  ): string {
    const parts = [
      STYLIST_PROMPT_VERSION,
      userId,
      humanImageHash ?? 'no-image',
      catalogFingerprint,
      dto.productId ?? 'none',
      dto.garmentDescription?.trim() || 'none',
      dto.occasion?.trim() || 'none',
      dto.stylePreference?.trim() || 'none',
      dto.budget?.trim() || 'none',
      dto.genderPreference?.trim() || 'none',
    ];
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
  }

  private buildCacheExpiry(): Date {
    return new Date(Date.now() + this.CACHE_TTL_MS);
  }

  async analyzeAndAdvise(
    userId: string,
    humanImage: Express.Multer.File | undefined,
    dto: StylistRequestDto,
  ) {
    if (!this.hasApiKey) {
      throw new HttpException(
        {
          statusCode: 503,
          message: 'Tính năng AI Stylist chưa được cấu hình API key (GEMINI_API_KEY).',
          error: 'GEMINI_NOT_CONFIGURED',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (humanImage && dto.imageConsent !== true) {
      throw new BadRequestException(
        'Vui lòng xác nhận ảnh là của bạn (hoặc bạn có quyền sử dụng) và đồng ý cho FashionAI phân tích ảnh.',
      );
    }

    const hasTextInput = [dto.garmentDescription, dto.occasion, dto.stylePreference].some((v) => v?.trim());
    if (!humanImage && !dto.productId && !hasTextInput) {
      throw new BadRequestException(
        'Vui lòng nhập ít nhất một thông tin: dịp mặc, phong cách, sản phẩm từ catalog, mô tả trang phục hoặc ảnh của bạn.',
      );
    }

    // Ảnh chỉ dùng để phân tích rồi bỏ; giữ hash (không khôi phục được ảnh) để tra cache.
    const humanImageHash = humanImage ? this.computeHash(humanImage.buffer) : null;
    const catalog = await this.productSuggestions.getCatalog();
    const cacheKey = this.buildCacheKey(userId, humanImageHash, catalog.fingerprint, dto);

    const cachedResult = await this.prisma.stylistResult.findFirst({
      where: {
        userId,
        cacheKey,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      include: { product: true },
    });

    if (cachedResult) {
      this.logger.log(`[Cache Hit] Trả về kết quả Stylist cũ cho user ${userId}`);
      const outfits = await this.productSuggestions.hydrateOutfits(
        (cachedResult.analysisResult as Partial<ParsedStylistResult> | null)?.outfits,
      );
      return this.toResultResponse(cachedResult, outfits, true);
    }

    this.logger.log(
      `AI Stylist analyze request | userId=${userId} | model=${this.MODEL} | productId=${dto.productId ?? 'none'} | hasImage=${Boolean(humanImage)}`,
    );

    try {
      const [product, measurements] = await Promise.all([
        dto.productId ? this.getProductContext(dto.productId) : Promise.resolve(null),
        this.getMeasurementContext(userId),
      ]);

      const anchorCode = product ? this.productSuggestions.findCodeByProductId(catalog, product.id) : null;
      const prompt = this.buildPrompt(dto, product, measurements, { catalog, anchorCode }, Boolean(humanImage));
      const { rawResponse, parsedResult } = await this.generateAnalysis(humanImage, prompt, {
        hasImage: Boolean(humanImage),
        catalog,
        anchorProductId: anchorCode ? product?.id : null,
      });

      const record = await this.prisma.stylistResult.create({
        data: {
          userId,
          productId: product?.id ?? null,
          humanImageUrl: null,
          humanImageHash,
          garmentDescription: dto.garmentDescription?.trim() || null,
          occasion: dto.occasion?.trim() || null,
          stylePreference: dto.stylePreference?.trim() || null,
          genderPreference: dto.genderPreference?.trim() || null,
          budget: dto.budget?.trim() || null,
          fitAdvice: parsedResult.fitAdvice || null,
          model: this.MODEL,
          analysisResult: parsedResult as any,
          inputContext: {
            productId: product?.id ?? null,
            productName: product?.name ?? null,
            garmentDescription: dto.garmentDescription?.trim() ?? null,
            occasion: dto.occasion?.trim() ?? null,
            stylePreference: dto.stylePreference?.trim() ?? null,
            budget: dto.budget?.trim() ?? null,
            genderPreference: dto.genderPreference?.trim() ?? null,
            hasMeasurements: Boolean(measurements),
            hasImage: Boolean(humanImage),
            imageConsentAt: humanImage ? new Date().toISOString() : null,
            catalogFingerprint: catalog.fingerprint,
          },
          rawProviderResponse: { text: rawResponse },
          cacheKey,
          expiresAt: this.buildCacheExpiry(),
        },
        include: { product: true },
      });

      await this.quotaService.consumeQuota(userId, 'STYLIST');

      const outfits = await this.productSuggestions.hydrateOutfits(parsedResult.outfits);
      return this.toResultResponse(record, outfits, false);
    } catch (error: unknown) {
      return this.handleError(error);
    }
  }

  private toResultResponse(record: StylistRecord, outfits: OutfitSuggestion[], isCached: boolean) {
    // JSON do chính service lưu; bản ghi cũ có thể thiếu field mới nên vẫn đọc an toàn bên dưới.
    const analysis = record.analysisResult as unknown as ParsedStylistResult;
    return {
      id: record.id,
      humanImageUrl: record.humanImageUrl,
      hasImage: this.hasImage(record),
      product: record.product,
      garmentDescription: record.garmentDescription,
      occasion: record.occasion,
      stylePreference: record.stylePreference,
      budget: record.budget,
      genderPreference: record.genderPreference,
      fitAdvice: record.fitAdvice,
      productCompatibilityScore: analysis?.productCompatibilityScore ?? null,
      warnings: analysis?.warnings ?? [],
      analysisResult: analysis,
      outfits,
      model: record.model ?? this.MODEL,
      createdAt: record.createdAt,
      isCached,
    };
  }

  private hasImage(record: Pick<StylistResult, 'humanImageHash' | 'humanImageUrl'>): boolean {
    return Boolean(record.humanImageHash || record.humanImageUrl);
  }

  private async getProductContext(productId: string): Promise<ProductContext> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { images: true },
    });
    if (!product) {
      throw new NotFoundException(`Không tìm thấy sản phẩm có ID ${productId}`);
    }

    const mainImage =
      product.images?.find((img) => img.isMain)?.imageUrl ??
      product.images?.[0]?.imageUrl ??
      product.garmentUrl;

    return {
      id: product.id,
      name: product.name,
      description: product.description,
      category: this.mapCategoryLabel(product.category),
      color: product.color,
      price: Number(product.price),
      imageUrl: mainImage,
    };
  }

  private async getMeasurementContext(userId: string): Promise<MeasurementContext | null> {
    try {
      const measurement = await this.prisma.measurement.findUnique({ where: { userId } });
      if (!measurement) return null;
      const m = measurement;
      const entries = [
        ['height', m.height],
        ['weight', m.weight],
        ['chest', m.chest],
        ['waist', m.waist],
        ['hip', m.hip],
        ['shoulder', m.shoulder],
      ] as const;
      const hasAny = entries.some(([, v]) => v !== null);
      if (!hasAny) return null;
      return Object.fromEntries(
        entries
          .filter(([, v]) => v !== null)
          .map(([k, v]) => [k, Number(v)]),
      ) as MeasurementContext;
    } catch (err) {
      this.logger.warn(`Failed to load measurements for user ${userId}: ${this.getErrorMessage(err)}`);
      return null;
    }
  }

  private buildPrompt(
    dto: StylistRequestDto,
    product: ProductContext | null,
    measurements: MeasurementContext | null,
    { catalog, anchorCode }: CatalogPromptContext,
    hasImage: boolean,
  ): string {
    const parts: (string | null)[] = [
      'Bạn là chuyên gia tư vấn phong cách cá nhân (AI Stylist) cho người Việt, chuyên về thời trang công sở, smart casual và trang phục sự kiện.',
      '',
      hasImage
        ? 'Bạn đang xem ảnh của người dùng (toàn thân/đầu) kèm theo bối cảnh bên dưới. Nhiệm vụ: phân tích vóc dáng, sắc tố da, màu cá nhân và gợi ý các bộ phối từ sản phẩm của cửa hàng.'
        : 'Người dùng KHÔNG gửi ảnh. Nhiệm vụ: gợi ý các bộ phối từ sản phẩm của cửa hàng dựa trên bối cảnh bên dưới. Không được đoán sắc tố da hay màu cá nhân; chỉ nhận xét dáng người khi có số đo.',
    ];

    if (product) {
      parts.push(
        '',
        'SẢN PHẨM ĐANG CÂN NHẮC (từ catalog thật của cửa hàng):',
        anchorCode ? `- Mã: ${anchorCode}` : null,
        `- Tên: ${product.name}`,
        `- Phân loại: ${product.category}`,
        product.color ? `- Màu sắc: ${product.color}` : null,
        product.price != null ? `- Giá: ${product.price.toLocaleString('vi-VN')} VNĐ` : null,
        product.description ? `- Mô tả: ${product.description}` : null,
      );
    }

    const occasionIsDefault = !dto.occasion?.trim();
    parts.push(
      '',
      'NHU CẦU CỦA NGƯỜI DÙNG:',
      product
        ? `- Trang phục cần tư vấn: sản phẩm "${product.name}" như mô tả trên.`
        : dto.garmentDescription?.trim()
          ? `- Trang phục người dùng mô tả: ${dto.garmentDescription.trim()}`
          : '- Người dùng chưa chọn món cụ thể: hãy tự phối hoàn toàn từ danh mục sản phẩm.',
      occasionIsDefault
        ? `- Dịp mặc: Công sở chuyên nghiệp (người dùng KHÔNG tự chọn, đây là giá trị mặc định khi họ không nhập dịp mặc)`
        : `- Dịp mặc: ${dto.occasion!.trim()}`,
    );

    if (dto.stylePreference?.trim()) {
      parts.push(`- Sở thích phong cách: ${dto.stylePreference.trim()}`);
    }
    if (dto.budget?.trim()) {
      parts.push(`- Ngân sách dự kiến cho một bộ: ${dto.budget.trim()}`);
    }
    if (dto.genderPreference?.trim()) {
      parts.push(`- Giới tính ưu tiên tư vấn: ${dto.genderPreference.trim()}`);
    }

    if (measurements) {
      const m = measurements;
      parts.push(
        '',
        'SỐ ĐO NGƯỜI DÙNG (đơn vị cm/kg) — hãy dùng để tư vấn phom/fit chính xác:',
        [
          m.height ? `- Cao: ${m.height}cm` : null,
          m.weight ? `- Nặng: ${m.weight}kg` : null,
          m.chest ? `- Vòng ngực: ${m.chest}cm` : null,
          m.waist ? `- Vòng eo: ${m.waist}cm` : null,
          m.hip ? `- Vòng mông: ${m.hip}cm` : null,
          m.shoulder ? `- Vai: ${m.shoulder}cm` : null,
        ]
          .filter((line): line is string => line !== null)
          .join('\n'),
      );
    } else {
      parts.push(
        '',
        hasImage
          ? 'CHƯA CÓ SỐ ĐO: hãy ước lượng sơ bộ từ ảnh và dùng cụm từ mang tính tham khảo ("khoảng", "có thể").'
          : 'CHƯA CÓ SỐ ĐO VÀ KHÔNG CÓ ẢNH: tư vấn phom dáng ở mức chung, không phán đoán vóc dáng cụ thể.',
      );
    }

    parts.push(
      '',
      `DANH MỤC SẢN PHẨM ĐANG BÁN (mã | tên | loại | màu | chất liệu | giá). Lưu ý: ${catalog.audienceNote}`,
      catalog.entries.length ? this.productSuggestions.formatCatalogForPrompt(catalog) : '(Hiện chưa có sản phẩm nào đang bán)',
      '',
      'QUY TẮC GỢI Ý BỘ PHỐI ("outfits"):',
      '- CHỈ dùng sản phẩm trong danh mục trên, tham chiếu bằng đúng mã (P1, P2...). Tuyệt đối không bịa mã hay sản phẩm.',
      '- Gợi ý 3 bộ (tối thiểu 2 nếu danh mục ít lựa chọn phù hợp), mỗi bộ 2–4 món, các bộ nên khác nhau rõ rệt.',
      '- Một bộ hợp lệ: áo + quần/chân váy (có thể thêm áo vest/blazer/áo khoác bên ngoài), hoặc đầm (có thể thêm áo khoác/blazer). Không ghép đầm với quần/chân váy, không ghép hai quần/chân váy.',
      '- Mọi món phải hợp với dịp mặc, sở thích phong cách, giới tính ưu tiên và (nếu có) dáng người, màu da, màu cá nhân của người dùng. Phối màu hài hòa giữa các món.',
      anchorCode ? `- BẮT BUỘC: mọi bộ đều phải chứa sản phẩm đang cân nhắc (mã ${anchorCode}).` : null,
      dto.budget?.trim()
        ? '- Tổng giá các món trong một bộ không vượt ngân sách. Nếu không bộ nào vừa ngân sách, chọn bộ tiết kiệm nhất và nêu rõ trong "warnings".'
        : null,
      '- "extras" chỉ ghi phụ kiện KHÔNG có trong danh mục (giày, túi, trang sức...) dưới dạng chữ, tối đa 3 món.',
      '- Nếu danh mục không có món phù hợp với nhu cầu (ví dụ người dùng là nam hoặc giới tính ưu tiên không khớp đối tượng của danh mục, dịp mặc không có sản phẩm tương ứng), trả "outfits": [] và giải thích trong "warnings". Không gợi ý đồ nữ cho người dùng nam.',
      '',
      'YÊU CẦU:',
      '- Trả lời hoàn toàn bằng tiếng Việt tự nhiên, dễ hiểu.',
      '- VIẾT NGẮN GỌN: kết quả hiển thị dạng thẻ trên điện thoại, mỗi field chỉ vài từ hoặc 1–2 câu như mô tả bên dưới, không viết đoạn văn dài.',
      '- Giọng văn lịch sự, thực tế, không phán xét ngoại hình.',
      '- Không dùng markdown, không thêm giải thích ngoài JSON.',
      '- Nếu "Dịp mặc" và "Sở thích phong cách" có vẻ mâu thuẫn với nhau (ví dụ dịp mặc trang trọng nhưng phong cách lại năng động/thể thao, hoặc ngược lại), hãy tự chọn ưu tiên hợp lý hơn (thường ưu tiên dịp mặc vì tính chất bắt buộc của hoàn cảnh) và GIẢI THÍCH NGẮN trong "warnings". Nếu dịp mặc đang dùng giá trị mặc định (xem chú thích ở trên), cũng cần nêu trong "warnings" để người dùng biết nên tự nhập dịp mặc cụ thể hơn.',
      '- Nếu không có mâu thuẫn và không dùng giá trị mặc định nào, trả "warnings": [] (mảng rỗng).',
      '- "fitRecommendation", "stylingTips", "verdict" luôn là chuỗi có nội dung, kể cả khi không có bộ phối phù hợp (khi đó đưa lời khuyên chung).',
      '- Chỉ trả về JSON hợp lệ đúng cấu trúc sau:',
      '{',
      hasImage
        ? '  "bodyType": "Dáng người, tối đa 8 từ (VD: Dáng chữ A, eo thon)",'
        : `  "bodyType": ${measurements ? '"Dáng người theo số đo, tối đa 8 từ"' : 'null'},`,
      hasImage ? '  "skinTone": "Sắc độ da, tối đa 8 từ (VD: Da sáng, tông ấm)",' : '  "skinTone": null,',
      hasImage ? '  "personalColor": "Tên nhóm màu cá nhân, tối đa 5 từ (VD: Mùa Thu ấm)",' : '  "personalColor": null,',
      '  "fitRecommendation": "Phom dáng nên chọn, 1 câu ngắn"',
      product ? '  ,"fitAdvice": "Phom/độ ôm khi đặt may sản phẩm này, 1 câu (VD: may ôm nhẹ ở eo, chừa rộng vai) hoặc null nếu không đủ dữ liệu. TUYỆT ĐỐI KHÔNG dùng size chữ như S/M/L/XL vì sản phẩm may theo số đo."' : null,
      product
        ? '  ,"productCompatibilityScore": 85'
        : '  ,"productCompatibilityScore": null',
      '  ,"colorSuggestions": [{ "name": "Tên màu ngắn, VD: Be", "hex": "#E8DCC8" }, { "name": "Navy", "hex": "#1F2A44" }],',
      '  "outfits": [',
      '    {',
      '      "name": "Tên bộ phối, 2–4 từ",',
      '      "reason": "Vì sao hợp với người dùng, 1 câu tối đa 20 từ",',
      '      "items": [{ "code": "P1", "note": "Cách mặc, tối đa 8 từ" }, { "code": "P2", "note": "..." }],',
      '      "extras": ["Giày cao gót màu nude"]',
      '    }',
      '  ],',
      '  "stylingTips": "Tối đa 3 mẹo phối đồ ngắn, mỗi mẹo một dòng bắt đầu bằng \\"- \\"",',
      product
        ? '  "verdict": "Sản phẩm có hợp không và vì sao, tối đa 2 câu ngắn",'
        : '  "verdict": "Tổng kết lời khuyên, tối đa 2 câu ngắn",',
      '  "warnings": ["Câu cảnh báo nếu dịp mặc và phong cách mâu thuẫn, dùng giá trị mặc định, vượt ngân sách hoặc không có món phù hợp"]',
      '}',
    );

    return parts.filter((p): p is string => p !== null).join('\n');
  }

  private mapCategoryLabel(category: string): string {
    switch (category) {
      case 'UPPER':
        return 'Áo trên';
      case 'LOWER':
        return 'Quần/Váy';
      case 'FULL_BODY':
        return 'Toàn thân';
      default:
        return category;
    }
  }


  /**
   * Gọi Gemini rồi parse kết quả. Nếu model trả về JSON sai/thiếu field, gửi lại
   * một lượt "repair" kèm chính output lỗi và thông báo lỗi cụ thể — gọi lại y
   * nguyên prompt cũ thường cho ra đúng lỗi đó lần nữa.
   */
  private async generateAnalysis(
    humanImage: Express.Multer.File | undefined,
    prompt: string,
    context: StylistValidationContext,
  ): Promise<{ rawResponse: string; parsedResult: ParsedStylistResult }> {
    const rawResponse = await this.callGeminiWithRetry(humanImage, prompt);

    try {
      return {
        rawResponse,
        parsedResult: this.validateResult(this.parseRawResponse(rawResponse), context),
      };
    } catch (parseError) {
      const reason = this.getErrorMessage(parseError);
      this.logger.warn(`Gemini trả về JSON không hợp lệ (${reason}). Thử repair prompt.`);

      const repaired = await this.callGeminiWithRetry(
        humanImage,
        this.buildRepairPrompt(prompt, rawResponse, reason),
        1,
      );

      // Nếu lượt repair vẫn sai, để lỗi nổi lên cho handleError xử lý (502).
      return {
        rawResponse: repaired,
        parsedResult: this.validateResult(this.parseRawResponse(repaired), context),
      };
    }
  }

  private buildRepairPrompt(
    originalPrompt: string,
    invalidOutput: string,
    reason: string,
  ): string {
    return [
      originalPrompt,
      '',
      '--- SỬA LỖI ĐỊNH DẠNG ---',
      'Câu trả lời trước của bạn không dùng được. Lý do:',
      reason,
      '',
      'Output trước đó (đã bị từ chối):',
      invalidOutput.slice(0, 2000),
      '',
      'Hãy trả lời lại. Bắt buộc:',
      '- CHỈ trả về một object JSON hợp lệ, không kèm markdown, không kèm giải thích.',
      '- Ký tự đầu tiên phải là "{" và ký tự cuối phải là "}".',
      '- Đầy đủ tất cả field bắt buộc với đúng kiểu dữ liệu như đã mô tả ở trên.',
      '- colorSuggestions là mảng object { name, hex } (hex dạng #RRGGBB); outfits là mảng object, mỗi item tham chiếu đúng mã sản phẩm trong danh mục.',
    ].join('\n');
  }

  private async callGeminiWithRetry(
    humanImage: Express.Multer.File | undefined,
    prompt: string,
    attempts = 2,
  ): Promise<string> {
    let lastError: unknown;

    const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [
      { text: prompt },
    ];
    if (humanImage) {
      parts.push({
        inlineData: {
          mimeType: humanImage.mimetype,
          data: humanImage.buffer.toString('base64'),
        },
      });
    }

    for (let i = 0; i < attempts; i++) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.MODEL,
          contents: [{ role: 'user', parts }],
          config: { responseMimeType: 'application/json' },
        });

        const text = response.text?.trim() ?? '';
        if (!text) {
          throw new Error('Gemini returned an empty response');
        }
        return text;
      } catch (error: unknown) {
        lastError = error;
        if (i < attempts - 1) {
          this.logger.warn(
            `Gemini attempt ${i + 1}/${attempts} failed: ${this.getErrorMessage(error)}`,
          );
        }
      }
    }

    throw lastError ?? new Error('Gemini failed without an error object');
  }

  parseRawResponse(text: string): Record<string, unknown> {
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    if (!cleaned) {
      throw new Error('Gemini returned an empty response');
    }

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error(
        `Gemini response did not contain JSON. Preview: ${cleaned.slice(0, 300)}`,
      );
    }

    const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonStr) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`Gemini returned invalid JSON: ${this.getErrorMessage(err)}`);
    }
  }


  validateResult(raw: Record<string, unknown>, context: StylistValidationContext = {}): ParsedStylistResult {
    const requireString = (key: string): string => {
      const value = raw[key];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`Gemini JSON thiếu field "${key}" hoặc sai kiểu (cần string).`);
      }
      return value.trim();
    };

    const optionalString = (key: string): string | null => {
      const value = raw[key];
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    };

    // Không có ảnh thì AI không được đoán da/màu cá nhân, nên các field này có thể null.
    const faceField = context.hasImage === false ? optionalString : requireString;

    const toArray = (key: string): string[] => {
      const value = raw[key];
      if (!Array.isArray(value)) {
        throw new Error(`Gemini JSON thiếu field "${key}" hoặc sai kiểu (cần mảng).`);
      }
      return value.map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          return (
            (typeof obj.name === 'string' ? obj.name : null) ??
            (typeof obj.color === 'string' ? obj.color : null) ??
            (typeof obj.type === 'string' ? obj.type : null) ??
            JSON.stringify(obj)
          );
        }
        return String(item);
      });
    };

    let score: number | null = null;
    if (raw.productCompatibilityScore !== undefined && raw.productCompatibilityScore !== null) {
      const parsedScore = Number(raw.productCompatibilityScore);
      score = Number.isFinite(parsedScore) ? Math.max(0, Math.min(100, Math.round(parsedScore))) : null;
    }

    const fitAdviceRaw = raw.fitAdvice;
    const fitAdvice =
      typeof fitAdviceRaw === 'string' && fitAdviceRaw.trim()
        ? fitAdviceRaw.trim()
        : null;

    // warnings là field phụ (cảnh báo xung đột occasion/stylePreference) — không
    // bắt buộc như các field dùng requireString/toArray ở trên, nên parse an toàn,
    // không throw nếu Gemini thiếu field hoặc trả sai kiểu.
    const warningsRaw = raw.warnings;
    const warnings = Array.isArray(warningsRaw)
      ? warningsRaw.filter((w): w is string => typeof w === 'string' && w.trim() !== '')
      : [];

    // Outfit cũng là field phụ: mã AI bịa hoặc bộ thiếu sản phẩm đang cân nhắc bị bỏ
    // thay vì làm hỏng cả lượt phân tích.
    const catalog = context.catalog;
    const outfits = catalog
      ? this.productSuggestions.resolveOutfits(raw.outfits, catalog, {
          anchorProductId: context.anchorProductId,
        })
      : [];
    if (catalog && Array.isArray(raw.outfits) && raw.outfits.length > 0 && outfits.length === 0) {
      this.logger.warn('Gemini gợi ý outfit nhưng không bộ nào hợp lệ với catalog (mã sai hoặc thiếu sản phẩm đang cân nhắc).');
    }

    return {
      bodyType: faceField('bodyType'),
      skinTone: faceField('skinTone'),
      personalColor: faceField('personalColor'),
      fitRecommendation: requireString('fitRecommendation'),
      fitAdvice,
      productCompatibilityScore: score,
      colorSuggestions: this.toColorSuggestions(raw.colorSuggestions),
      outfits,
      outfitCombinations:
        catalog && outfits.length
          ? outfits.map((outfit) => this.productSuggestions.describeOutfit(outfit, catalog))
          : Array.isArray(raw.outfitCombinations)
            ? toArray('outfitCombinations')
            : [],
      stylingTips: requireString('stylingTips'),
      verdict: requireString('verdict'),
      warnings,
    };
  }

  /** 3–5 màu nên mặc; chấp nhận cả chuỗi (kết quả kiểu cũ) và bỏ mã hex sai định dạng. */
  private toColorSuggestions(value: unknown): ColorSuggestion[] {
    if (!Array.isArray(value)) {
      throw new Error('Gemini JSON thiếu field "colorSuggestions" hoặc sai kiểu (cần mảng).');
    }
    return value
      .map((item): ColorSuggestion | null => {
        if (typeof item === 'string') return item.trim() ? { name: item.trim(), hex: null } : null;
        if (!item || typeof item !== 'object') return null;
        const obj = item as Record<string, unknown>;
        const name = typeof obj.name === 'string' ? obj.name.trim() : typeof obj.color === 'string' ? obj.color.trim() : '';
        if (!name) return null;
        const hex = typeof obj.hex === 'string' && /^#[0-9a-f]{6}$/i.test(obj.hex.trim()) ? obj.hex.trim().toUpperCase() : null;
        return { name, hex };
      })
      .filter((color): color is ColorSuggestion => color !== null)
      .slice(0, 6);
  }

  async getUserHistory(userId: string, page = 1, limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * safeLimit;
    const [items, total] = await Promise.all([
      this.prisma.stylistResult.findMany({
        where: { userId },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        include: { product: true },
      }),
      this.prisma.stylistResult.count({ where: { userId } }),
    ]);

    // Load sản phẩm của mọi outfit trong trang một lần thay vì mỗi kết quả một query.
    const storedByItem = items.map((item) =>
      this.productSuggestions.parseStoredOutfits(
        (item.analysisResult as Partial<ParsedStylistResult> | null)?.outfits,
      ),
    );
    const products = await this.productSuggestions.loadProducts(storedByItem.flatMap(collectProductIds));

    return {
      items: items.map((item, index) => ({
        ...item,
        hasImage: this.hasImage(item),
        outfits: this.productSuggestions.buildOutfits(storedByItem[index], products),
      })),
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getHistoryItem(userId: string, id: string) {
    const item = await this.findOwnedResult(userId, id);
    const outfits = await this.productSuggestions.hydrateOutfits(
      (item.analysisResult as Partial<ParsedStylistResult> | null)?.outfits,
    );
    return { ...item, hasImage: this.hasImage(item), outfits };
  }

  async deleteHistoryItem(userId: string, id: string) {
    await this.findOwnedResult(userId, id);
    return this.prisma.stylistResult.delete({ where: { id } });
  }

  private async findOwnedResult(userId: string, id: string): Promise<StylistRecord> {
    const item = await this.prisma.stylistResult.findFirst({
      where: { id, userId },
      include: { product: true },
    });
    if (!item) {
      throw new NotFoundException(`Stylist result not found: ${id}`);
    }
    return item;
  }

  private handleError(error: unknown): never {
    const message = this.getErrorMessage(error);
    this.logger.error(`AI Stylist failed | model=${this.MODEL} | details=${message}`);

    if (error instanceof HttpException) {
      throw error;
    }

    if (
      message.includes('API_KEY') ||
      message.includes('401') ||
      message.toLowerCase().includes('api key')
    ) {
      throw new HttpException(
        {
          statusCode: 401,
          message: 'GEMINI_API_KEY is invalid or missing.',
          error: 'INVALID_API_KEY',
          details: message,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (message.includes('429') || message.toLowerCase().includes('quota')) {
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Gemini quota is exhausted. Please retry later or use another API key/project.',
          error: 'QUOTA_EXCEEDED',
          details: message,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (
      message.includes('Unexpected token') ||
      message.includes('did not contain JSON') ||
      message.includes('empty response') ||
      message.includes('invalid JSON') ||
      message.includes('thiếu field') ||
      message.includes('sai kiểu')
    ) {
      throw new HttpException(
        {
          statusCode: 502,
          message: 'Gemini trả về dữ liệu không hợp lệ. Vui lòng thử lại.',
          error: 'GEMINI_INVALID_RESPONSE',
          details: message,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    throw new HttpException(
      {
        statusCode: 500,
        message: 'AI Stylist analysis failed.',
        error: 'GEMINI_ERROR',
        details: message,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error';
    }
  }
}
