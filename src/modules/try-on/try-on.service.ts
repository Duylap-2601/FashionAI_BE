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
import axios from 'axios';
import * as crypto from 'crypto';
import { GarmentCategory } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { QuotaService } from '../../common/services/quota.service';
import { RedisService } from '../../common/services/redis.service';

type FashnCategory = 'tops' | 'bottoms' | 'one-pieces';

export interface TryOnResultResponse {
  id: string;
  resultUrl: string;
  category: GarmentCategory;
  isCached: boolean;
  createdAt: Date;
  product?: any;
}

@Injectable()
export class TryOnService {
  private readonly logger = new Logger(TryOnService.name);
  private readonly TIMEOUT_MS: number;
  private readonly SAM2_ENABLED: boolean;
  private readonly provider: 'fal' | 'mock';

  private readonly FASHN_MODEL: string;
  private readonly SAM2_MODEL: string;

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

    if (!falKey) {
      this.logger.warn('[fal.ai] FAL_KEY chưa được cấu hình!');
    } else {
      fal.config({ credentials: falKey });
    }

    this.logger.log(`[fal.ai] Khởi tạo | model=${this.FASHN_MODEL} | SAM2=${this.SAM2_ENABLED}`);
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

  async generateTryOn(
    userId: string,
    humanImage: Express.Multer.File,
    garmentImage?: Express.Multer.File,
    productId?: string,
    garmentCategory: GarmentCategory = GarmentCategory.UPPER,
  ): Promise<TryOnResultResponse> {
    let garmentBuffer: Buffer;
    let garmentMime = 'image/jpeg';
    let productEntity = null;

    if (productId) {
      productEntity = await this.prisma.product.findUnique({ where: { id: productId } });
      if (!productEntity) {
        throw new NotFoundException(`Không tìm thấy sản phẩm có ID ${productId}`);
      }
      garmentCategory = productEntity.category;
      
      if (this.provider === 'mock') {
        garmentBuffer = Buffer.from(productEntity.garmentUrl);
      } else {
        const imgRes = await axios.get<ArrayBuffer>(productEntity.garmentUrl, {
          responseType: 'arraybuffer',
          timeout: 15000,
        });
        garmentBuffer = Buffer.from(imgRes.data);
      }
    } else if (garmentImage) {
      garmentBuffer = garmentImage.buffer;
      garmentMime = garmentImage.mimetype;
    } else {
      throw new BadRequestException('Vui lòng truyền productId hoặc tải lên ảnh trang phục (garmentImage)');
    }

    const humanHash = this.computeHash(humanImage.buffer);
    const garmentHash = this.computeHash(garmentBuffer);

    // Lock duplicate active request
    const lockKey = `lock:tryon:${userId}:${humanHash}:${garmentHash}`;
    const acquired = await this.redisService.acquireLock(lockKey, 60);
    if (!acquired) {
      throw new HttpException(
        {
          success: false,
          code: 'DUPLICATE_REQUEST',
          message: 'Yêu cầu thử đồ tương tự đang được xử lý. Vui lòng chờ trong giây lát.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      // ── Step 0: Check Cache ───────────────────────────────────────────────
      const cachedResult = await this.prisma.tryOnResult.findFirst({
        where: {
          humanImageHash: humanHash,
          garmentImageHash: garmentHash,
          category: garmentCategory,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (cachedResult) {
        this.logger.log(`[Cache Hit] Trả về kết quả thử đồ cũ cho user ${userId}`);
        await this.redisService.releaseLock(lockKey);
        return {
          id: cachedResult.id,
          resultUrl: cachedResult.resultUrl,
          category: cachedResult.category,
          isCached: true,
          createdAt: cachedResult.createdAt,
          product: productEntity,
        };
      }

      if (this.provider === 'mock') {
        return this.generateMockTryOnResult(
          userId,
          productId,
          humanHash,
          garmentHash,
          garmentCategory,
          productEntity,
        );
      }

      // ── Step 1: Upload to fal.storage ────────────────────────────────────
      const category = this.mapCategory(garmentCategory);
      this.logger.log(`[fal.ai] Bắt đầu Try-On | category=${category}`);

      const [humanUrl, garmentRawUrl] = await Promise.all([
        this.uploadToFalStorage(humanImage.buffer, humanImage.mimetype, 'humanImage'),
        this.uploadToFalStorage(garmentBuffer, garmentMime, 'garmentImage'),
      ]);

      // ── Step 2: SAM2 Segment ─────────────────────────────────────────────
      let garmentUrl = garmentRawUrl;
      if (this.SAM2_ENABLED) {
        garmentUrl = await this.segmentGarment(garmentRawUrl);
      }

      // ── Step 3: FASHN Virtual Try-On ─────────────────────────────────────
      const mode = this.config.get<string>('FASHN_MODE', 'balanced');
      const tryOnResult = await this.withTimeout(
        fal.subscribe(this.FASHN_MODEL, {
          input: {
            model_image: humanUrl,
            garment_image: garmentUrl,
            category,
            mode,
            garment_photo_type: 'auto',
          },
        }),
        'FASHN try-on timed out',
      );

      const rawResultUrl: string | undefined =
        (tryOnResult.data as any)?.images?.[0]?.url ??
        (tryOnResult.data as any)?.image?.url;

      if (!rawResultUrl) {
        throw new Error('Mô hình AI không trả về URL ảnh kết quả');
      }

      // ── Step 4: Persist image to Cloudinary storage ─────────────────────
      const imgRes = await axios.get<ArrayBuffer>(rawResultUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      const resultBuffer = Buffer.from(imgRes.data);
      const permanentResultUrl = await this.storageService.uploadImage(
        resultBuffer,
        'try-on-results',
        `tryon_${userId}_${Date.now()}`,
      );

      // Save history record
      const savedRecord = await this.prisma.tryOnResult.create({
        data: {
          userId,
          productId: productId ?? null,
          humanImageHash: humanHash,
          garmentImageHash: garmentHash,
          category: garmentCategory,
          resultUrl: permanentResultUrl,
          providerMetadata: (tryOnResult.data as any) ?? {},
        },
      });

      // Deduct User Quota upon successful creation
      await this.quotaService.consumeQuota(userId, 'TRY_ON');

      return {
        id: savedRecord.id,
        resultUrl: permanentResultUrl,
        category: garmentCategory,
        isCached: false,
        createdAt: savedRecord.createdAt,
        product: productEntity,
      };
    } catch (error) {
      return this.handleError(error);
    } finally {
      await this.redisService.releaseLock(lockKey);
    }
  }

  async fetchImageStream(url: string): Promise<StreamableFile> {
    const imgRes = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    return new StreamableFile(Buffer.from(imgRes.data), {
      type: 'image/jpeg',
      disposition: 'inline; filename="tryon-result.jpg"',
    });
  }

  private async generateMockTryOnResult(
    userId: string,
    productId: string | undefined,
    humanHash: string,
    garmentHash: string,
    garmentCategory: GarmentCategory,
    productEntity: any,
  ): Promise<TryOnResultResponse> {
    const configuredUrl = this.config.get<string>('MOCK_TRYON_RESULT_URL');
    const resultUrl =
      configuredUrl ||
      (await this.storageService.uploadImage(
        this.getMockResultPng(),
        'try-on-results',
        `mock_tryon_${userId}_${Date.now()}`,
      ));

    const savedRecord = await this.prisma.tryOnResult.create({
      data: {
        userId,
        productId: productId ?? null,
        humanImageHash: humanHash,
        garmentImageHash: garmentHash,
        category: garmentCategory,
        resultUrl,
        providerMetadata: {
          provider: 'mock',
          model: 'mock-tryon',
          note: 'Generated without fal.ai for local and frontend testing.',
        },
      },
    });

    await this.quotaService.consumeQuota(userId, 'TRY_ON');

    return {
      id: savedRecord.id,
      resultUrl,
      category: garmentCategory,
      isCached: false,
      createdAt: savedRecord.createdAt,
      product: productEntity,
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

  private handleError(error: unknown): never {
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
