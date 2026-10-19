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
import { buildApiResponse } from '../../common/utils/api-response.util';

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
    summary: 'Tư vấn phong cách & gợi ý outfit từ catalog (Có Auth & Quota)',
    description:
      'Gemini gợi ý các bộ phối chỉ gồm sản phẩm đang bán, theo dịp mặc/phong cách/ngân sách/số đo. ' +
      'Ảnh người dùng là tùy chọn (cần imageConsent=true), chỉ dùng để phân tích dáng/màu da và không được lưu.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        humanImage: { type: 'string', format: 'binary', description: 'Ảnh người dùng (tùy chọn, rõ mặt, đủ ánh sáng). Không được lưu.' },
        imageConsent: { type: 'boolean', description: 'Bắt buộc true khi gửi humanImage' },
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
    @UploadedFile() humanImage: Express.Multer.File | undefined,
    @Body() dto: StylistRequestDto,
  ) {
    if (humanImage) {
      const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
      filePipe.transform(humanImage);
    }

    const result = await this.stylistService.analyzeAndAdvise(user.id, humanImage, dto);

    return buildApiResponse(
      req,
      'STYLIST_ANALYZE_SUCCESS',
      'Phân tích và tư vấn thời trang AI thành công',
      result,
    );
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
    return buildApiResponse(
      req,
      'STYLIST_HISTORY_SUCCESS',
      'Lấy lịch sử tư vấn thành công',
      result.items,
      result.meta,
    );
  }

  @Get('history/:id')
  @ApiOperation({ summary: 'Chi tiết lịch sử tư vấn theo ID' })
  async getHistoryItem(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const data = await this.stylistService.getHistoryItem(user.id, id);
    return buildApiResponse(req, 'STYLIST_ITEM_SUCCESS', 'Lấy chi tiết tư vấn thành công', data);
  }

  @Delete('history/:id')
  @ApiOperation({ summary: 'Xóa kết quả tư vấn khỏi lịch sử' })
  async deleteHistoryItem(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.stylistService.deleteHistoryItem(user.id, id);
    return buildApiResponse(req, 'STYLIST_DELETE_SUCCESS', 'Xóa lịch sử tư vấn thành công', null);
  }
}
