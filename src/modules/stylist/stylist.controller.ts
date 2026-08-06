import {
  Controller,
  Post,
  Get,
  Delete,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  UseGuards,
  Req,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { QuotaGuard, AiAction } from '../../common/guards/quota.guard';
import { FileValidationPipe } from '../../common/pipes/file-validation.pipe';
import { StylistService } from './stylist.service';
import { StylistRequestDto } from './dto/stylist-request.dto';
import { StylistResponseDto } from './dto/stylist-response.dto';

@ApiTags('AI Stylist')
@Controller('stylist')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class StylistController {
  constructor(private readonly stylistService: StylistService) {}

  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseGuards(QuotaGuard)
  @AiAction('STYLIST')
  @ApiOperation({
    summary: 'Phân tích Personal Color & Tư vấn trang phục (Có Auth & Quota)',
    description: 'Upload ảnh người dùng, Gemini Vision sẽ phân tích dáng người, màu da và đề xuất phong cách phù hợp.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['humanImage'],
      properties: {
        humanImage: { type: 'string', format: 'binary', description: 'Ảnh người dùng (rõ mặt, đủ ánh sáng)' },
        productId: { type: 'string', description: 'ID sản phẩm từ catalog. Nếu truyền, AI sẽ tư vấn dựa trên sản phẩm thật.' },
        garmentDescription: { type: 'string', description: 'Mô tả trang phục (tên, màu, chất liệu). Không bắt buộc nếu có productId.' },
        occasion: { type: 'string', example: 'Họp quan trọng tại văn phòng' },
        stylePreference: { type: 'string', description: 'Sở thích phong cách (minimal, lịch lãm, năng động...)' },
        budget: { type: 'string', description: 'Ngân sách dự kiến (VND)' },
        genderPreference: { type: 'string', enum: ['male', 'female', 'other'], description: 'Giới tính ưu tiên tư vấn' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Kết quả tư vấn AI Stylist', type: StylistResponseDto })
  @UseInterceptors(FileInterceptor('humanImage'))
  async analyze(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() humanImage: Express.Multer.File,
    @Body() dto: StylistRequestDto,
  ) {
    if (!humanImage) {
      throw new BadRequestException('Vui lòng upload ảnh người dùng (humanImage)');
    }

    const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
    filePipe.transform(humanImage);

    const result = await this.stylistService.analyzeAndAdvise(user.id, humanImage, dto);

    return {
      success: true,
      code: 'STYLIST_ANALYZE_SUCCESS',
      message: 'Phân tích và tư vấn thời trang AI thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data: result,
    };
  }

  @Get('history')
  @ApiOperation({ summary: 'Lịch sử tư vấn của người dùng' })
  async getHistory(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const result = await this.stylistService.getUserHistory(user.id, page ? Number(page) : 1, limit ? Number(limit) : 20);
    return {
      success: true,
      code: 'STYLIST_HISTORY_SUCCESS',
      message: 'Lấy lịch sử tư vấn thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data: result.items,
      meta: result.meta,
    };
  }

  @Get('history/:id')
  @ApiOperation({ summary: 'Chi tiết lịch sử tư vấn theo ID' })
  async getHistoryItem(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const data = await this.stylistService.getHistoryItem(user.id, id);
    return {
      success: true,
      code: 'STYLIST_ITEM_SUCCESS',
      message: 'Lấy chi tiết tư vấn thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data,
    };
  }

  @Delete('history/:id')
  @ApiOperation({ summary: 'Xóa kết quả tư vấn khỏi lịch sử' })
  async deleteHistoryItem(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.stylistService.deleteHistoryItem(user.id, id);
    return {
      success: true,
      code: 'STYLIST_DELETE_SUCCESS',
      message: 'Xóa lịch sử tư vấn thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data: null,
    };
  }
}
