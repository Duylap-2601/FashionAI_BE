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
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { QuotaService } from '../../common/services/quota.service';
import { StylistRequestDto } from './dto/stylist-request.dto';
import * as crypto from 'crypto';

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

export interface ParsedStylistResult {
  bodyType: string;
  skinTone: string;
  personalColor: string;
  fitRecommendation: string;
  fitAdvice?: string | null;
  productCompatibilityScore?: number | null;
  colorSuggestions: string[];
  outfitCombinations: string[];
  stylingTips: string;
  verdict: string;
}

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
    private readonly storageService: StorageService,
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
    humanImageHash: string,
    productId: string | undefined,
    garmentDescription: string | null,
    occasion: string | null,
    stylePreference: string | null,
    budget: string | null,
    genderPreference: string | null,
  ): string {
    const parts = [
      userId,
      humanImageHash,
      productId ?? 'none',
      garmentDescription ?? 'none',
      occasion ?? 'none',
      stylePreference ?? 'none',
      budget ?? 'none',
      genderPreference ?? 'none',
    ];
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
  }

  private buildCacheExpiry(): Date {
    return new Date(Date.now() + this.CACHE_TTL_MS);
  }

  async analyzeAndAdvise(
    userId: string,
    humanImage: Express.Multer.File,
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

    if (!dto.productId && !dto.garmentDescription?.trim()) {
      throw new BadRequestException(
        'Vui lòng chọn sản phẩm từ catalog (productId) hoặc nhập mô tả trang phục (garmentDescription).',
      );
    }

    // Compute hash of human image for cache key
    const humanImageHash = this.computeHash(humanImage.buffer);

    // Build cache key from all input parameters that affect the result
    const cacheKey = this.buildCacheKey(
      userId,
      humanImageHash,
      dto.productId,
      dto.garmentDescription?.trim() || null,
      dto.occasion?.trim() || null,
      dto.stylePreference?.trim() || null,
      dto.budget?.trim() || null,
      dto.genderPreference?.trim() || null,
    );

    // Check cache first
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
      return {
        id: cachedResult.id,
        humanImageUrl: cachedResult.humanImageUrl,
        product: cachedResult.product,
        garmentDescription: cachedResult.garmentDescription,
        occasion: cachedResult.occasion,
        stylePreference: cachedResult.stylePreference,
        budget: cachedResult.budget,
        genderPreference: cachedResult.genderPreference,
        fitAdvice: cachedResult.fitAdvice,
        productCompatibilityScore: (cachedResult.analysisResult as any)?.productCompatibilityScore ?? null,
        analysisResult: cachedResult.analysisResult as any,
        model: cachedResult.model ?? this.MODEL,
        createdAt: cachedResult.createdAt,
        isCached: true,
      };
    }

    this.logger.log(
      `AI Stylist analyze request | userId=${userId} | model=${this.MODEL} | productId=${dto.productId ?? 'none'}`,
    );

    try {
      const humanImageUrl = await this.storageService.uploadImage(
        humanImage.buffer,
        'stylist-inputs',
        `stylist_${userId}_${Date.now()}`,
      );

      const [product, measurements] = await Promise.all([
        dto.productId ? this.getProductContext(dto.productId) : Promise.resolve(null),
        this.getMeasurementContext(userId),
      ]);

      const prompt = this.buildPrompt(dto, product, measurements);
      const { rawResponse, parsedResult } = await this.generateAnalysis(
        humanImage,
        prompt,
      );

      const record = await this.prisma.stylistResult.create({
        data: {
          userId,
          productId: product?.id ?? null,
          humanImageUrl,
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
          },
          rawProviderResponse: { text: rawResponse },
          cacheKey,
          expiresAt: this.buildCacheExpiry(),
        },
        include: { product: true },
      });

      await this.quotaService.consumeQuota(userId, 'STYLIST');

      return {
        id: record.id,
        humanImageUrl,
        product: record.product,
        garmentDescription: dto.garmentDescription,
        occasion: dto.occasion,
        stylePreference: dto.stylePreference,
        budget: dto.budget,
        genderPreference: dto.genderPreference,
        fitAdvice: parsedResult.fitAdvice ?? null,
        productCompatibilityScore: parsedResult.productCompatibilityScore ?? null,
        analysisResult: parsedResult,
        model: this.MODEL,
        createdAt: record.createdAt,
        isCached: false,
      };
    } catch (error: unknown) {
      return this.handleError(error);
    }
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
  ): string {
    const parts: (string | null)[] = [
      'Bạn là chuyên gia tư vấn phong cách cá nhân (AI Stylist) cho người Việt, chuyên về thời trang công sở, smart casual và trang phục sự kiện.',
      '',
      'Bạn đang xem ảnh của người dùng (toàn thân/đầu) kèm theo bối cảnh bên dưới. Nhiệm vụ: phân tích vóc dáng, sắc tố da, màu cá nhân và tư vấn trang phục.',
    ];

    if (product) {
      parts.push(
        '',
        'SẢN PHẨM ĐANG CÂN NHẮC (từ catalog thật của cửa hàng):',
        `- Tên: ${product.name}`,
        `- Phân loại: ${product.category}`,
        product.color ? `- Màu sắc: ${product.color}` : null,
        product.price != null ? `- Giá: ${product.price.toLocaleString('vi-VN')} VNĐ` : null,
        product.description ? `- Mô tả: ${product.description}` : null,
      );
    }

    parts.push(
      '',
      'TRANG PHỤC CẦN TƯ VẤN:',
      product
        ? `Sản phẩm "${product.name}" như mô tả trên.`
        : `Mô tả của người dùng: ${dto.garmentDescription}`,
      `- Dịp mặc: ${dto.occasion?.trim() || 'Công sở chuyên nghiệp'}`,
    );

    if (dto.stylePreference?.trim()) {
      parts.push(`- Sở thích phong cách: ${dto.stylePreference.trim()}`);
    }
    if (dto.budget?.trim()) {
      parts.push(`- Ngân sách dự kiến: ${dto.budget.trim()}`);
    }
    if (dto.genderPreference?.trim()) {
      parts.push(`- Giới tính ưu tiên tư vấn: ${dto.genderPreference.trim()}`);
    }

    if (measurements) {
      const m = measurements;
      parts.push(
        '',
        'SỐ ĐO NGƯỜI DÙNG (đơn vị cm/kg) — hãy dùng để tư vấn size/fit chính xác:',
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
        'CHƯA CÓ SỐ ĐO: hãy ước lượng sơ bộ từ ảnh và dùng cụm từ mang tính tham khảo ("khoảng", "có thể").',
      );
    }

    parts.push(
      '',
      'YÊU CẦU:',
      '- Trả lời hoàn toàn bằng tiếng Việt tự nhiên, dễ hiểu.',
      '- Giọng văn lịch sự, thực tế, không phán xét ngoại hình.',
      '- Không dùng markdown, không thêm giải thích ngoài JSON.',
      '- Chỉ trả về JSON hợp lệ đúng cấu trúc sau:',
      '{',
      '  "bodyType": "Nhận xét dáng người bằng tiếng Việt",',
      '  "skinTone": "Nhận xét sắc độ da bằng tiếng Việt",',
      '  "personalColor": "Nhóm màu cá nhân phù hợp bằng tiếng Việt",',
      '  "fitRecommendation": "Gợi ý phom dáng/cách ôm sát bằng tiếng Việt"',
      product ? '  ,"fitAdvice": "Gợi ý phom/độ ôm khi đặt may theo số đo (VD: nên may ôm nhẹ ở eo, chừa rộng vai) hoặc null nếu không đủ dữ liệu. TUYỆT ĐỐI KHÔNG dùng size chữ như S/M/L/XL vì sản phẩm may theo số đo."' : null,
      product
        ? '  ,"productCompatibilityScore": 85'
        : '  ,"productCompatibilityScore": null',
      '  ,"colorSuggestions": ["Màu gợi ý 1", "Màu gợi ý 2", "Màu gợi ý 3"],',
      '  "outfitCombinations": ["Bộ phối 1", "Bộ phối 2", "Bộ phối 3"],',
      '  "stylingTips": "Mẹo phối đồ cụ thể bằng tiếng Việt",',
      '  "verdict": "Kết luận sản phẩm có phù hợp không và lý do bằng tiếng Việt"',
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
    humanImage: Express.Multer.File,
    prompt: string,
  ): Promise<{ rawResponse: string; parsedResult: ParsedStylistResult }> {
    const rawResponse = await this.callGeminiWithRetry(humanImage, prompt);

    try {
      return {
        rawResponse,
        parsedResult: this.validateResult(this.parseRawResponse(rawResponse)),
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
        parsedResult: this.validateResult(this.parseRawResponse(repaired)),
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
      '- colorSuggestions và outfitCombinations phải là mảng các chuỗi.',
    ].join('\n');
  }

  private async callGeminiWithRetry(
    humanImage: Express.Multer.File,
    prompt: string,
    attempts = 2,
  ): Promise<string> {
    let lastError: unknown;

    for (let i = 0; i < attempts; i++) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.MODEL,
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: humanImage.mimetype,
                    data: humanImage.buffer.toString('base64'),
                  },
                },
              ],
            },
          ],
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

  validateResult(raw: Record<string, unknown>): ParsedStylistResult {
    const requireString = (key: string): string => {
      const value = raw[key];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`Gemini JSON thiếu field "${key}" hoặc sai kiểu (cần string).`);
      }
      return value.trim();
    };

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

    return {
      bodyType: requireString('bodyType'),
      skinTone: requireString('skinTone'),
      personalColor: requireString('personalColor'),
      fitRecommendation: requireString('fitRecommendation'),
      fitAdvice,
      productCompatibilityScore: score,
      colorSuggestions: toArray('colorSuggestions'),
      outfitCombinations: toArray('outfitCombinations'),
      stylingTips: requireString('stylingTips'),
      verdict: requireString('verdict'),
    };
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

    return {
      items,
      meta: {
        total,
        page,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async getHistoryItem(userId: string, id: string) {
    const item = await this.prisma.stylistResult.findFirst({
      where: { id, userId },
      include: { product: true },
    });
    if (!item) {
      throw new NotFoundException(`Stylist result not found: ${id}`);
    }
    return item;
  }

  async deleteHistoryItem(userId: string, id: string) {
    await this.getHistoryItem(userId, id);
    return this.prisma.stylistResult.delete({ where: { id } });
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
