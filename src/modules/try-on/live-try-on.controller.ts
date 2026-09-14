import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { buildApiResponse } from '../../common/utils/api-response.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateLiveSessionDto } from './dto/create-live-session.dto';
import { EndLiveSessionDto } from './dto/end-live-session.dto';
import { LiveTryOnService } from './live-try-on.service';

@ApiTags('Virtual Try-On')
@Controller('try-on/live')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class LiveTryOnController {
  constructor(private readonly liveTryOnService: LiveTryOnService) {}

  @Get('quota')
  @ApiOperation({ summary: 'Xem quota Live Try-On theo giây' })
  async getQuota(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.liveTryOnService.getQuota(user);
    return buildApiResponse(req, 'LIVE_TRYON_QUOTA_SUCCESS', 'Lấy quota Live Try-On thành công', data);
  }

  @Get('garments/:productId')
  @ApiOperation({ summary: 'Lấy garment reference đã kiểm tra cho Live Try-On' })
  async getGarment(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('productId') productId: string,
  ) {
    const data = await this.liveTryOnService.getGarment(user, productId);
    return buildApiResponse(req, 'LIVE_TRYON_GARMENT_SUCCESS', 'Lấy garment Live Try-On thành công', data);
  }

  @Post('sessions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tạo phiên Live Try-On Decart' })
  async createSession(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLiveSessionDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Headers('origin') origin?: string,
  ) {
    const data = await this.liveTryOnService.createSession(user, dto, idempotencyKey, origin);
    return buildApiResponse(req, 'LIVE_TRYON_SESSION_CREATED', 'Tạo phiên Live Try-On thành công', data);
  }

  @Post('sessions/:id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kết thúc phiên Live Try-On theo client' })
  async endSession(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: EndLiveSessionDto,
  ) {
    const data = await this.liveTryOnService.endSession(user, id, dto.reason);
    return buildApiResponse(req, 'LIVE_TRYON_SESSION_ENDED', 'Ghi nhận kết thúc phiên Live Try-On thành công', data);
  }
}
