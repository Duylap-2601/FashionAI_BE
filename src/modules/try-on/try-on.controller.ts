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
  Body,
  UseGuards,
  Req,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { GarmentCategory } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { QuotaGuard, AiAction } from '../../common/guards/quota.guard';
import { FileValidationPipe } from '../../common/pipes/file-validation.pipe';
import { TryOnService } from './try-on.service';
import { TryOnRequestDto } from './dto/try-on-request.dto';
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
        garmentImage: { type: 'string', format: 'binary', description: 'Ảnh trang phục (nếu không dùng productId)' },
        productId: { type: 'string', description: 'ID sản phẩm từ catalog (nếu không tải garmentImage)' },
        garmentCategory: {
          type: 'string',
          enum: ['UPPER', 'LOWER', 'FULL_BODY'],
          default: 'UPPER',
          description: 'Phân loại trang phục',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Trả về thông tin kết quả thử đồ và resultUrl.' })
  @ApiResponse({ status: 429, description: 'Đã hết lượt Quota trong ngày hoặc duplicate request.' })
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'humanImage', maxCount: 1 },
      { name: 'garmentImage', maxCount: 1 },
    ]),
  )
  async tryOn(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files: { humanImage?: Express.Multer.File[]; garmentImage?: Express.Multer.File[] },
    @Body() dto: TryOnRequestDto,
  ) {
    const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });

    if (!files.humanImage?.[0]) {
      throw new BadRequestException('Vui lòng tải lên ảnh người (humanImage)');
    }
    filePipe.transform(files.humanImage[0]);

    if (files.garmentImage?.[0]) {
      filePipe.transform(files.garmentImage[0]);
    }

    const category = dto.garmentCategory ?? GarmentCategory.UPPER;

    const result = await this.tryOnService.generateTryOn(
      user.id,
      files.humanImage[0],
      files.garmentImage?.[0],
      dto.productId,
      category,
    );

    return buildApiResponse(
      req,
      'TRY_ON_SUCCESS',
      result.isCached ? 'Lấy kết quả thử đồ từ Cache' : 'Thử đồ AI thành công',
      result,
    );
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
