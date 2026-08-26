import {
  Controller,
  Post,
  Get,
  Delete,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  UseGuards,
  Req,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { GarmentCategory } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { QuotaGuard, AiAction } from '../../common/guards/quota.guard';
import { FileValidationPipe } from '../../common/pipes/file-validation.pipe';
import { TryOnService, TryOnGarmentInput } from './try-on.service';
import { buildApiResponse } from '../../common/utils/api-response.util';

@ApiTags('Virtual Try-On')
@Controller('try-on')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class TryOnController {
  constructor(private readonly tryOnService: TryOnService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(QuotaGuard)
  @AiAction('TRY_ON')
  @ApiOperation({
    summary: 'AI Virtual Try-On (Bảo vệ bởi Auth & Quota)',
    description: `Upload ảnh người + ảnh trang phục (hoặc truyền productId) → trả về kết quả thử đồ.\n\n**garmentCategory:**\n- \`UPPER\` = Áo trên\n- \`LOWER\` = Quần/Váy\n- \`FULL_BODY\` = Toàn thân`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['humanImage'],
      properties: {
        humanImage: { type: 'string', format: 'binary', description: 'Ảnh người dùng (toàn thân)' },
        // Combo (Phase 3): gửi mảng garments[N][image]/[category]/[productId]. Tối đa 2 món
        // (1 UPPER + 1 LOWER) hoặc 1 FULL_BODY. Mỗi món tính 1 lượt quota.
        'garments[0][image]': { type: 'string', format: 'binary', description: 'Ảnh món 1 (nếu không dùng productId)' },
        'garments[0][category]': { type: 'string', enum: ['UPPER', 'LOWER', 'FULL_BODY'], description: 'Phân loại món 1' },
        'garments[0][productId]': { type: 'string', description: 'ID sản phẩm cho món 1 (thay cho ảnh)' },
        'garments[1][image]': { type: 'string', format: 'binary', description: 'Ảnh món 2' },
        'garments[1][category]': { type: 'string', enum: ['UPPER', 'LOWER', 'FULL_BODY'], description: 'Phân loại món 2' },
        'garments[1][productId]': { type: 'string', description: 'ID sản phẩm cho món 2' },
        // Legacy 1 món: vẫn hỗ trợ để tương thích ngược.
        garmentImage: { type: 'string', format: 'binary', description: '[Legacy] Ảnh trang phục đơn' },
        productId: { type: 'string', description: '[Legacy] ID sản phẩm đơn' },
        garmentCategory: {
          type: 'string',
          enum: ['UPPER', 'LOWER', 'FULL_BODY'],
          default: 'UPPER',
          description: '[Legacy] Phân loại trang phục đơn',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Trả về thông tin kết quả thử đồ và resultUrl.' })
  @ApiResponse({ status: 429, description: 'Đã hết lượt Quota trong ngày hoặc duplicate request.' })
  @UseInterceptors(AnyFilesInterceptor())
  async tryOn(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
    const fileList = files ?? [];
    const body = (req.body ?? {}) as Record<string, unknown>;

    const humanImage = fileList.find((f) => f.fieldname === 'humanImage');
    if (!humanImage) {
      throw new BadRequestException('Vui lòng tải lên ảnh người (humanImage)');
    }
    filePipe.transform(humanImage);

    const garments = this.parseGarments(body, fileList);
    if (garments.length === 0) {
      throw new BadRequestException('Vui lòng cung cấp ít nhất một món (garmentImage/productId hoặc garments[])');
    }
    for (const g of garments) {
      if (g.image) filePipe.transform(g.image);
    }

    const result = await this.tryOnService.generateTryOn(user.id, humanImage, garments, {
      tier: user.tier,
      tierExpiresAt: user.tierExpiresAt,
    });

    return buildApiResponse(
      req,
      'TRY_ON_SUCCESS',
      result.isCached ? 'Lấy kết quả thử đồ từ Cache' : 'Thử đồ AI thành công',
      result,
    );
  }

  // Đọc garments từ multipart: ưu tiên shape mảng garments[N][...], nếu không có thì
  // rơi về shape đơn cũ (garmentImage/garmentCategory/productId) và bọc thành 1 phần tử.
  private parseGarments(body: Record<string, unknown>, files: Express.Multer.File[]): TryOnGarmentInput[] {
    const indexed = new Map<number, TryOnGarmentInput>();
    const bracket = /^garments\[(\d+)\]\[(image|category|productId)\]$/;

    const ensure = (idx: number): TryOnGarmentInput => {
      let g = indexed.get(idx);
      if (!g) {
        g = {};
        indexed.set(idx, g);
      }
      return g;
    };

    for (const file of files) {
      const m = bracket.exec(file.fieldname);
      if (m && m[2] === 'image') {
        ensure(Number(m[1])).image = file;
      }
    }

    // multer (append-field) đã gộp garments[N][category] thành body.garments = [{...}],
    // nên đọc category/productId từ mảng lồng này thay vì từ key phẳng.
    const bodyGarments = body.garments;
    if (bodyGarments && typeof bodyGarments === 'object') {
      for (const [idxKey, item] of Object.entries(bodyGarments as Record<string, unknown>)) {
        const idx = Number(idxKey);
        if (!Number.isInteger(idx) || !item || typeof item !== 'object') continue;
        const entry = item as Record<string, unknown>;
        const g = ensure(idx);
        if (entry.category != null) g.category = this.toGarmentCategory(entry.category);
        if (entry.productId != null) g.productId = String(entry.productId);
      }
    }

    if (indexed.size > 0) {
      return [...indexed.entries()].sort(([a], [b]) => a - b).map(([, g]) => g);
    }

    // Legacy: 1 món.
    const legacyImage = files.find((f) => f.fieldname === 'garmentImage');
    const legacyProductId = body.productId ? String(body.productId) : undefined;
    if (!legacyImage && !legacyProductId) {
      return [];
    }
    return [
      {
        image: legacyImage,
        productId: legacyProductId,
        category: this.toGarmentCategory(body.garmentCategory) ?? GarmentCategory.UPPER,
      },
    ];
  }

  private toGarmentCategory(value: unknown): GarmentCategory | undefined {
    if (typeof value !== 'string') return undefined;
    const upper = value.toUpperCase();
    if (upper in GarmentCategory) {
      return GarmentCategory[upper as keyof typeof GarmentCategory];
    }
    throw new BadRequestException(`garmentCategory không hợp lệ: ${value}`);
  }

  @Get('history')
  @ApiOperation({ summary: 'Xem lịch sử thử đồ của người dùng' })
  async getHistory(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const result = await this.tryOnService.getUserHistory(user.id, page ? Number(page) : 1, limit ? Number(limit) : 20);
    return buildApiResponse(
      req,
      'TRY_ON_HISTORY_SUCCESS',
      'Lấy lịch sử thử đồ thành công',
      result.items,
      result.meta,
    );
  }

  @Get('history/:id')
  @ApiOperation({ summary: 'Chi tiết một lịch sử thử đồ theo ID' })
  async getHistoryItem(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const data = await this.tryOnService.getHistoryItem(user.id, id);
    return buildApiResponse(req, 'TRY_ON_ITEM_SUCCESS', 'Lấy chi tiết lịch sử thành công', data);
  }

  @Get('history/:id/download')
  @ApiOperation({
    summary: 'Tải ảnh kết quả thử đồ',
    description: 'Trả về file ảnh dạng attachment thay vì JSON envelope.',
  })
  @ApiResponse({ status: 200, description: 'File ảnh kết quả thử đồ.' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy kết quả thử đồ.' })
  async downloadResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.tryOnService.downloadResult(user.id, id);
  }

  // Phải khai báo trước 'history/:id' để 'all' không bị nhận thành id.
  @Delete('history/all')
  @ApiOperation({ summary: 'Xóa toàn bộ lịch sử thử đồ của người dùng' })
  async deleteAllHistory(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.tryOnService.deleteAllHistory(user.id);
    return buildApiResponse(
      req,
      'TRY_ON_DELETE_ALL_SUCCESS',
      `Đã xóa ${data.deleted} kết quả thử đồ`,
      data,
    );
  }

  @Delete('history/:id')
  @ApiOperation({ summary: 'Xóa một kết quả thử đồ khỏi lịch sử' })
  async deleteHistoryItem(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.tryOnService.deleteHistoryItem(user.id, id);
    return buildApiResponse(req, 'TRY_ON_DELETE_SUCCESS', 'Xóa lịch sử thử đồ thành công', null);
  }
}
