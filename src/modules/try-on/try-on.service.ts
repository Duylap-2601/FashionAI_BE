import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  StreamableFile,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fal } from '@fal-ai/client';
import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import * as crypto from 'crypto';
import { GarmentCategory, Prisma, UserTier } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { QuotaService } from '../../common/services/quota.service';
import { RedisService } from '../../common/services/redis.service';

type FashnCategory = 'tops' | 'bottoms' | 'one-pieces';

export interface TryOnGarmentInput {
  category?: GarmentCategory;
  productId?: string;
  image?: Express.Multer.File;
}

interface ResolvedGarment {
  category: GarmentCategory;
  productId: string | null;
  buffer: Buffer;
  mime: string;
  hash: string;
  product: any | null;
}

export interface TryOnQuotaContext {
  tier?: UserTier;
  tierExpiresAt?: Date | null;
}

export interface TryOnResultResponse {
  id: string;
  resultUrl: string;
  category: GarmentCategory;
  garments?: Array<{ category: GarmentCategory; productId: string | null }>;
  isCached: boolean;
  cacheKey: string;
  expiresAt: Date | null;
  createdAt: Date;
  product?: any;
}

@Injectable()
export class TryOnService {
  private readonly logger = new Logger(TryOnService.name);
  private readonly TIMEOUT_MS: number;
  private readonly SAM2_ENABLED: boolean;
  private readonly provider: 'fal' | 'mock';
  private readonly CACHE_TTL_MS: number;
  private readonly MAX_GARMENTS = 2;

  private readonly FASHN_MODEL: string;
  private readonly SAM2_MODEL: string;

  private readonly ai: GoogleGenAI | null;
  private readonly QUALITY_GATE_ENABLED: boolean;
  private readonly QUALITY_GATE_MODEL: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly quotaService: QuotaService,
    private readonly redisService: RedisService,
  ) {
    const falKey = this.config.get<string>('FAL_KEY') ?? '';
    this.TIMEOUT_MS = parseInt(this.config.get<string>('TIMEOUT_MS') ?? '120000', 10);
    this.SAM2_ENABLED = this.config.get<string>('SAM2_ENABLED') !== 'false';
    this.FASHN_MODEL = this.config.get<string>('FASHN_MODEL') ?? 'fal-ai/fashn/tryon/v1.6';
    this.SAM2_MODEL = this.config.get<string>('SAM2_MODEL') ?? 'fal-ai/sam2/auto-segment';
    this.provider =
      this.config.get<string>('AI_TRYON_PROVIDER') === 'mock' ? 'mock' : 'fal';
    this.CACHE_TTL_MS =
      parseInt(this.config.get<string>('TRYON_CACHE_TTL_DAYS') ?? '30', 10) *
      24 *
      60 *
      60 *
      1000;

    // Cổng kiểm tra chất lượng ảnh bằng Gemini trước khi gọi fal.ai (tốn phí).
    // Chỉ bật khi có GEMINI_API_KEY và cờ TRYON_QUALITY_GATE_ENABLED=true.
    const geminiKey = this.config.get<string>('GEMINI_API_KEY');
    this.ai = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null;
    this.QUALITY_GATE_ENABLED =
      this.config.get<string>('TRYON_QUALITY_GATE_ENABLED') === 'true' &&
      Boolean(geminiKey);
    this.QUALITY_GATE_MODEL = this.config.get<string>('GEMINI_MODEL', 'gemini-2.0-flash');

    if (!falKey) {
      this.logger.warn('[fal.ai] FAL_KEY chưa được cấu hình!');
    } else {
      fal.config({ credentials: falKey });
    }

    this.logger.log(
      `[fal.ai] Khởi tạo | model=${this.FASHN_MODEL} | SAM2=${this.SAM2_ENABLED} | ` +
        `qualityGate=${this.QUALITY_GATE_ENABLED}`,
    );
  }

  private mapCategory(garmentCategory: GarmentCategory): FashnCategory {
    switch (garmentCategory) {
      case GarmentCategory.LOWER:
        return 'bottoms';
      case GarmentCategory.FULL_BODY:
        return 'one-pieces';
      case GarmentCategory.UPPER:
      default:
        return 'tops';
    }
  }

  private validateGarments(garments: TryOnGarmentInput[]): void {
    if (!garments || garments.length === 0) {
      throw new BadRequestException(
        'Vui lòng truyền ít nhất 1 trang phục trong garments[]',
      );
    }

    if (garments.length > this.MAX_GARMENTS) {
      throw new BadRequestException(
        `Tối đa ${this.MAX_GARMENTS} trang phục mỗi lần. Bạn truyền ${garments.length}.`,
      );
    }

    const categories = garments
      .map((g) => g.category ?? GarmentCategory.UPPER)
      .filter((c) => c);
    const uniqueCategories = new Set(categories);

    if (categories.length !== uniqueCategories.size) {
      throw new BadRequestException('Không thể chọn nhiều trang phục cùng phân loại');
    }

    if (
      garments.length > 1 &&
      categories.some((c) => c === GarmentCategory.FULL_BODY)
    ) {
      throw new BadRequestException(
        'FULL_BODY (toàn thân) chỉ có thể đứng riêng, không kết hợp với trang phục khác',
      );
    }

    for (let i = 0; i < garments.length; i++) {
      const g = garments[i];
      const hasImage = !!g.image;
      const hasProductId = !!g.productId;

      if (!hasImage && !hasProductId) {
        throw new BadRequestException(
          `Trang phục ${i + 1}: phải truyền hoặc image hoặc productId`,
        );
      }

      if (hasImage && hasProductId) {
        throw new BadRequestException(
          `Trang phục ${i + 1}: chỉ chọn 1 trong image hoặc productId, không cả 2`,
        );
      }
    }
  }

  private async resolveGarments(
    garments: TryOnGarmentInput[],
  ): Promise<ResolvedGarment[]> {
    const resolved: ResolvedGarment[] = [];

    for (let i = 0; i < garments.length; i++) {
      const g = garments[i];
      const category = g.category ?? GarmentCategory.UPPER;
      let buffer: Buffer;
      let mime = 'image/jpeg';
      let productId: string | null = null;
      let product = null;

      if (g.productId) {
        productId = g.productId;
        product = await this.prisma.product.findUnique({
          where: { id: productId },
          include: { images: true },
        });
        if (!product) {
          throw new NotFoundException(
            `Sản phẩm ${i + 1} có ID ${productId} không tồn tại`,
          );
        }

        if (this.provider === 'mock') {
          buffer = Buffer.from(product.garmentUrl);
        } else {
          const imgRes = await axios.get<ArrayBuffer>(product.garmentUrl, {
            responseType: 'arraybuffer',
            timeout: 15000,
          });
          buffer = Buffer.from(imgRes.data);
        }
      } else if (g.image) {
        buffer = g.image.buffer;
        mime = g.image.mimetype;
      } else {
        throw new BadRequestException(
          `Trang phục ${i + 1}: không tìm thấy image hoặc productId`,
        );
      }

      const hash = this.computeHash(buffer);
      resolved.push({
        category,
        productId,
        buffer,
        mime,
        hash,
        product,
      });
    }

    return resolved;
  }

  private buildComboCacheKey(
    userId: string,
    humanHash: string,
    garments: ResolvedGarment[],
  ): string {
    const garmentHashes = garments
      .map((g) => g.hash)
      .sort()
      .join(':');
    const categories = garments
      .map((g) => g.category)
      .sort()
      .join(':');
    return `${userId}:${humanHash}:${garmentHashes}:${categories}`;
  }

  private categoryOrder(category: GarmentCategory): number {
    switch (category) {
      case GarmentCategory.UPPER:
        return 0;
      case GarmentCategory.LOWER:
        return 1;
      case GarmentCategory.FULL_BODY:
        return 2;
      default:
        return 3;
    }
  }

  private async uploadToFalStorage(buffer: Buffer, mimetype: string, label: string): Promise<string> {
    this.logger.log(`[fal.storage] Uploading ${label} (${buffer.length} bytes)...`);
    const blob = new Blob([buffer], { type: mimetype || 'image/jpeg' });
    const url = await fal.storage.upload(blob);
    this.logger.log(`[fal.storage] ${label} → ${url}`);
    return url;
  }

  private async segmentGarment(garmentUrl: string): Promise<string> {
    this.logger.log(`[SAM2] Bắt đầu segment garment...`);
    try {
      const samResult = await this.withTimeout(
        (fal.subscribe as any)(this.SAM2_MODEL, {
          input: { image_url: garmentUrl },
        }),
        'SAM2 timed out',
      );

      const data = (samResult as any)?.data;
      const segmentedUrl: string | undefined =
        data?.image?.url ??
        data?.images?.[0]?.url ??
        data?.masked_image?.url ??
        data?.output_image?.url;

      if (segmentedUrl) {
        this.logger.log(`[SAM2] Segment hoàn tất → ${segmentedUrl}`);
        return segmentedUrl;
      }
      return garmentUrl;
    } catch (err: any) {
      this.logger.warn(`[SAM2] Segment thất bại (${err?.message}), fallback về ảnh gốc`);
      return garmentUrl;
    }
  }

  private computeHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Cổng chất lượng: hỏi Gemini xem ảnh người có dùng được cho Try-On không
   * (rõ nét, đủ người, một người, không che khuất). Nếu ảnh hỏng thì ném 422
   * ngay để không tốn chi phí fal.ai. Gemini lỗi/timeout → cho qua (fail-open)
   * để sự cố phía Gemini không chặn tính năng chính.
   */
  private async assertHumanImageUsable(
    humanImage: Express.Multer.File,
  ): Promise<void> {
    if (!this.ai) return;

    const prompt = [
      'Bạn là bộ lọc chất lượng ảnh cho hệ thống thử đồ ảo.',
      'Kiểm tra ảnh người dùng và trả về DUY NHẤT một object JSON hợp lệ:',
      '{ "usable": true|false, "reason": "lý do ngắn gọn bằng tiếng Việt" }',
      'Ảnh KHÔNG dùng được nếu: mờ/nhoè, thiếu sáng nghiêm trọng, không thấy người,',
      'có nhiều hơn một người, bị che khuất phần lớn cơ thể, hoặc chỉ có mặt/cận cảnh',
      '(cần thấy tối thiểu nửa thân trên để thử đồ). Không thêm markdown hay giải thích.',
    ].join('\n');

    let text: string;
    try {
      const response = await this.withTimeout(
        this.ai.models.generateContent({
          model: this.QUALITY_GATE_MODEL,
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
        }),
        'Quality gate timed out',
      );
      text = response.text?.trim() ?? '';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.warn(`[QualityGate] Bỏ qua do lỗi Gemini: ${message}`);
      return;
    }

    const verdict = this.parseQualityVerdict(text);
    if (verdict && verdict.usable === false) {
      this.logger.log(`[QualityGate] Từ chối ảnh: ${verdict.reason}`);
      throw new HttpException(
        {
          statusCode: 422,
          message:
            verdict.reason ||
            'Ảnh không đạt yêu cầu để thử đồ. Vui lòng chụp rõ nét, đủ sáng và thấy toàn thân.',
          error: 'IMAGE_QUALITY_REJECTED',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private parseQualityVerdict(
    text: string,
  ): { usable: boolean; reason: string } | null {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first === -1 || last <= first) return null;
    try {
      const raw = JSON.parse(text.slice(first, last + 1)) as Record<
        string,
        unknown
      >;
      if (typeof raw.usable !== 'boolean') return null;
      return {
        usable: raw.usable,
        reason: typeof raw.reason === 'string' ? raw.reason.trim() : '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Cache key gắn userId: ảnh kết quả là dữ liệu cá nhân, nên hai user upload
   * cùng một ảnh vẫn phải sinh kết quả riêng thay vì dùng lại của nhau.
   */
  private buildCacheKey(
    userId: string,
    humanHash: string,
    garmentHash: string,
    category: GarmentCategory,
  ): string {
    return `${userId}:${humanHash}:${garmentHash}:${category}`;
  }

  private buildCacheExpiry(): Date {
    return new Date(Date.now() + this.CACHE_TTL_MS);
  }

  async generateTryOn(
    userId: string,
    humanImage: Express.Multer.File,
    garments: TryOnGarmentInput[],
    quotaCtx: TryOnQuotaContext = {},
  ): Promise<TryOnResultResponse> {
    this.validateGarments(garments);

    const resolved = await this.resolveGarments(garments);
    // Chuỗi thứ tự: áo trên trước, rồi quần/váy, cuối là toàn thân.
    resolved.sort(
      (a, b) => this.categoryOrder(a.category) - this.categoryOrder(b.category),
    );

    const humanHash = this.computeHash(humanImage.buffer);
    const isCombo = resolved.length > 1;
    const cacheKey = isCombo
      ? this.buildComboCacheKey(userId, humanHash, resolved)
      : this.buildCacheKey(userId, humanHash, resolved[0].hash, resolved[0].category);

    const lockKey = `lock:tryon:${userId}:${humanHash}:${resolved
      .map((g) => g.hash)
      .join(':')}`;
    const acquired = await this.redisService.acquireLock(lockKey, 60);
    if (!acquired) {
      throw new HttpException(
        {
          success: false,
          code: 'DUPLICATE_REQUEST',
          message:
            'Yêu cầu thử đồ tương tự đang được xử lý. Vui lòng chờ trong giây lát.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const primaryProduct = resolved[0].product;
    const finalCategory = resolved[resolved.length - 1].category;
    const garmentsMeta = resolved.map((g) => ({
      category: g.category,
      productId: g.productId,
    }));

    try {
      // ── Step 0: Cache ──────────────────────────────────────────────────
      const cachedResult = await this.prisma.tryOnResult.findFirst({
        where: {
          userId,
          cacheKey,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: 'desc' },
      });

      if (cachedResult) {
        this.logger.log(`[Cache Hit] Trả về kết quả thử đồ cũ cho user ${userId}`);
        return {
          id: cachedResult.id,
          resultUrl: cachedResult.resultUrl,
          category: cachedResult.category,
          garments: (cachedResult.garments as any) ?? garmentsMeta,
          isCached: true,
          cacheKey: cachedResult.cacheKey ?? cacheKey,
          expiresAt: cachedResult.expiresAt,
          createdAt: cachedResult.createdAt,
          product: primaryProduct,
        };
      }

      // Trừ theo số món: kiểm tra đủ hạn mức TRƯỚC khi tốn phí provider.
      await this.quotaService.assertQuota(
        userId,
        quotaCtx.tier,
        'TRY_ON',
        quotaCtx.tierExpiresAt,
        resolved.length,
      );

      if (this.provider === 'mock') {
        return this.generateMockTryOnResult(
          userId,
          humanHash,
          resolved,
          cacheKey,
          garmentsMeta,
        );
      }

      if (this.QUALITY_GATE_ENABLED) {
        await this.assertHumanImageUsable(humanImage);
      }
      // ── Chuỗi FASHN: kết quả bước trước là model_image của bước sau ─────
      const mode = this.config.get<string>('FASHN_MODE', 'balanced');
      let modelUrl = await this.uploadToFalStorage(
        humanImage.buffer,
        humanImage.mimetype,
        'humanImage',
      );
      const providerMeta: any[] = [];

      for (const g of resolved) {
        let garmentUrl = await this.uploadToFalStorage(
          g.buffer,
          g.mime,
          `garment_${g.category}`,
        );
        if (this.SAM2_ENABLED) {
          garmentUrl = await this.segmentGarment(garmentUrl);
        }

        const step = await this.withTimeout(
          fal.subscribe(this.FASHN_MODEL, {
            input: {
              model_image: modelUrl,
              garment_image: garmentUrl,
              category: this.mapCategory(g.category),
              mode,
              garment_photo_type: 'auto',
            },
          }),
          'FASHN try-on timed out',
        );

        const stepUrl: string | undefined =
          (step.data as any)?.images?.[0]?.url ?? (step.data as any)?.image?.url;
        if (!stepUrl) {
          throw new Error('Mô hình AI không trả về URL ảnh kết quả');
        }
        modelUrl = stepUrl;
        providerMeta.push(step.data ?? {});
      }
      // ── Lưu ảnh cuối cùng vào storage ──────────────────────────────────
      const imgRes = await axios.get<ArrayBuffer>(modelUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      const permanentResultUrl = await this.storageService.uploadImage(
        Buffer.from(imgRes.data),
        'try-on-results',
        `tryon_${userId}_${Date.now()}`,
      );

      const savedRecord = await this.prisma.tryOnResult.create({
        data: {
          userId,
          productId: resolved[0].productId,
          humanImageHash: humanHash,
          garmentImageHash: resolved.map((g) => g.hash).join(':'),
          category: finalCategory,
          garments: garmentsMeta as unknown as Prisma.InputJsonValue,
          resultUrl: permanentResultUrl,
          cacheKey,
          expiresAt: this.buildCacheExpiry(),
          providerMetadata: (isCombo
            ? providerMeta
            : providerMeta[0] ?? {}) as Prisma.InputJsonValue,
        },
      });

      // Trừ quota theo số món sau khi tạo thành công.
      await this.quotaService.consumeQuota(userId, 'TRY_ON', resolved.length);

      return {
        id: savedRecord.id,
        resultUrl: permanentResultUrl,
        category: finalCategory,
        garments: garmentsMeta,
        isCached: false,
        cacheKey,
        expiresAt: savedRecord.expiresAt,
        createdAt: savedRecord.createdAt,
        product: primaryProduct,
      };
    } catch (error) {
      return this.handleError(error);
    } finally {
      await this.redisService.releaseLock(lockKey);
    }
  }

  /**
   * Tải ảnh kết quả về dưới dạng attachment. Đi qua backend thay vì trả URL gốc
   * để FE không phải xử lý CORS của storage provider khi người dùng bấm tải.
   */
  async downloadResult(userId: string, id: string): Promise<StreamableFile> {
    const item = await this.getHistoryItem(userId, id);

    // Ảnh fallback lưu dạng data URL khi chưa cấu hình Cloudinary.
    const dataUrlMatch = item.resultUrl.match(
      /^data:(image\/[a-z+]+);base64,(.+)$/i,
    );
    if (dataUrlMatch) {
      return new StreamableFile(Buffer.from(dataUrlMatch[2], 'base64'), {
        type: dataUrlMatch[1],
        disposition: `attachment; filename="tryon-${id}.${this.extensionFor(dataUrlMatch[1])}"`,
      });
    }

    let response: { data: ArrayBuffer; headers: Record<string, any> };
    try {
      response = await axios.get<ArrayBuffer>(item.resultUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`[Download] Không tải được ảnh kết quả ${id}: ${message}`);
      throw new HttpException(
        {
          statusCode: 502,
          message: 'Không thể tải ảnh kết quả từ storage. Vui lòng thử lại.',
          error: 'RESULT_FETCH_FAILED',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const contentType =
      typeof response.headers?.['content-type'] === 'string' &&
      response.headers['content-type'].startsWith('image/')
        ? response.headers['content-type']
        : 'image/jpeg';

    return new StreamableFile(Buffer.from(response.data), {
      type: contentType,
      disposition: `attachment; filename="tryon-${id}.${this.extensionFor(contentType)}"`,
    });
  }

  private extensionFor(mimeType: string): string {
    switch (mimeType) {
      case 'image/png':
        return 'png';
      case 'image/webp':
        return 'webp';
      default:
        return 'jpg';
    }
  }

  private async generateMockTryOnResult(
    userId: string,
    humanHash: string,
    garments: ResolvedGarment[],
    cacheKey: string,
    garmentsMeta: Array<{ category: GarmentCategory; productId: string | null }>,
  ): Promise<TryOnResultResponse> {
    const configuredUrl = this.config.get<string>('MOCK_TRYON_RESULT_URL');
    const resultUrl =
      configuredUrl ||
      (await this.storageService.uploadImage(
        this.getMockResultPng(),
        'try-on-results',
        `mock_tryon_${userId}_${Date.now()}`,
      ));

    const finalCategory = garments[garments.length - 1].category;
    const savedRecord = await this.prisma.tryOnResult.create({
      data: {
        userId,
        productId: garments[0].productId,
        humanImageHash: humanHash,
        garmentImageHash: garments.map((g) => g.hash).join(':'),
        category: finalCategory,
        garments: garmentsMeta as unknown as Prisma.InputJsonValue,
        resultUrl,
        cacheKey,
        expiresAt: this.buildCacheExpiry(),
        providerMetadata: {
          provider: 'mock',
          model: 'mock-tryon',
          note: 'Generated without fal.ai for local and frontend testing.',
        },
      },
    });

    await this.quotaService.consumeQuota(userId, 'TRY_ON', garments.length);

    return {
      id: savedRecord.id,
      resultUrl,
      category: finalCategory,
      garments: garmentsMeta,
      isCached: false,
      cacheKey,
      expiresAt: savedRecord.expiresAt,
      createdAt: savedRecord.createdAt,
      product: garments[0].product,
    };
  }

  private getMockResultPng() {
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64',
    );
  }

  private async withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), this.TIMEOUT_MS);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async getUserHistory(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.tryOnResult.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { product: true },
      }),
      this.prisma.tryOnResult.count({ where: { userId } }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getHistoryItem(userId: string, id: string) {
    const item = await this.prisma.tryOnResult.findFirst({
      where: { id, userId },
      include: { product: true },
    });
    if (!item) {
      throw new NotFoundException(`Không tìm thấy kết quả thử đồ có ID ${id}`);
    }
    return item;
  }

  async deleteHistoryItem(userId: string, id: string) {
    await this.getHistoryItem(userId, id);
    return this.prisma.tryOnResult.delete({ where: { id } });
  }

  async deleteAllHistory(userId: string) {
    const { count } = await this.prisma.tryOnResult.deleteMany({
      where: { userId },
    });
    this.logger.log(`[History] Đã xóa ${count} kết quả thử đồ của user ${userId}`);
    return { deleted: count };
  }

  private handleError(error: unknown): never {
    // Lỗi đã có mã HTTP rõ ràng (vd cổng chất lượng 422) thì giữ nguyên, không
    // bọc thành 500.
    if (error instanceof HttpException) {
      throw error;
    }

    const msg = error instanceof Error ? error.message : 'Lỗi không xác định';
    this.logger.error(`[fal.ai] Lỗi Try-On: ${msg}`);

    if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('AbortError')) {
      throw new HttpException(
        { statusCode: 408, message: 'Thời gian chờ xử lý AI quá lâu. Vui lòng thử lại.', error: 'TIMEOUT' },
        HttpStatus.REQUEST_TIMEOUT,
      );
    }
    if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
      throw new HttpException(
        { statusCode: 503, message: 'Không thể kết nối tới mô hình AI. Thử lại sau.', error: 'CONNECTION_FAILED' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    throw new HttpException(
      { statusCode: 500, message: 'Lỗi khi gọi mô hình Virtual Try-On', error: 'AI_ERROR', details: msg },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
