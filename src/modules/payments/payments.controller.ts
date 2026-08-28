import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CheckoutDto } from './dto/checkout.dto';
import { SubscriptionHistoryQueryDto } from './dto/subscription-history-query.dto';
import { PaymentsService } from './payments.service';
import { SubscriptionService } from './subscription.service';
import { buildPlanList } from '../../common/constants/subscription-plans.constants';
import { buildApiResponse } from '../../common/utils/api-response.util';

@ApiTags('Payments & Subscriptions')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Tạo liên kết thanh toán',
    description:
      'Truyền `orderId` để thanh toán đơn hàng sản phẩm đã tạo qua `POST /orders`, ' +
      'hoặc truyền `targetTier` để nâng cấp gói tài khoản.',
  })
  async checkout(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CheckoutDto,
  ) {
    const data = await this.paymentsService.createCheckoutLink(user.id, dto);
    return buildApiResponse(req, 'PAYMENT_CHECKOUT_CREATED', 'Tạo liên kết thanh toán thành công', data);
  }

  @Public()
  @Post('sepay-ipn')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhận IPN thanh toán từ SePay' })
  async sepayIPN(@Req() req: Request, @Body() ipnData: any) {
    return this.paymentsService.handleSePayIPN(
      ipnData,
      req.headers,
      (req as Request & { rawBody?: Buffer }).rawBody,
    );
  }

  @Public()
  @Post('sepay-webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhận webhook chuyển khoản ngân hàng từ SePay' })
  async sepayWebhook(@Req() req: Request, @Body() payload: any) {
    return this.paymentsService.handleSePayBankWebhook(
      payload,
      req.headers,
      (req as Request & { rawBody?: Buffer }).rawBody,
    );
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Xem lịch sử đơn thanh toán của tôi' })
  async getMyOrders(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.paymentsService.getUserOrders(user.id);
    return buildApiResponse(req, 'USER_ORDERS_SUCCESS', 'Lấy danh sách đơn hàng thành công', data);
  }

  @Public()
  @Get('mock-success')
  @ApiOperation({
    summary: 'Mock thanh toán thành công (chỉ development)',
    description: 'Endpoint này bị chặn hoàn toàn ở production (NODE_ENV=production)'
  })
  async mockSuccess(@Req() req: Request, @Query('orderCode') orderCode: number) {
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv === 'production') {
      return {
        success: false,
        code: 'MOCK_DISABLED_IN_PRODUCTION',
        message: 'Mock payment endpoint is disabled in production.',
        timestamp: new Date().toISOString(),
        path: req.originalUrl ?? req.url,
      };
    }
    const result = await this.paymentsService.mockSuccess(Number(orderCode));
    return buildApiResponse(req, 'MOCK_PAYMENT_SUCCESS', 'Giả lập thanh toán thành công', result);
  }

  @Get('plans')
  @Public()
  @ApiOperation({ summary: 'Lấy danh sách gói và giá' })
  async getPlans(@Req() req: Request) {
    const plans = buildPlanList();
    return buildApiResponse(req, 'PLANS_LIST_SUCCESS', 'Lấy danh sách gói thành công', plans);
  }

  @Get('subscriptions/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Lấy thông tin gói đăng ký hiện tại' })
  async getCurrentSubscription(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.subscriptionService.getCurrentSubscription(user.id);
    return buildApiResponse(req, 'SUBSCRIPTION_ME_SUCCESS', 'Lấy thông tin gói đăng ký thành công', data);
  }

  @Get('subscriptions/history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Lấy lịch sử gói đăng ký' })
  async getSubscriptionHistory(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SubscriptionHistoryQueryDto,
  ) {
    const result = await this.subscriptionService.getSubscriptionHistory(
      user.id,
      query.page || 1,
      query.limit || 20,
    );
    return buildApiResponse(
      req,
      'SUBSCRIPTION_HISTORY_SUCCESS',
      'Lấy lịch sử gói đăng ký thành công',
      result.items,
      result.meta,
    );
  }

  @Post('subscriptions/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tắt tự động gia hạn',
    description: 'Tắt auto-renew cho gói hiện tại. Người dùng vẫn được sử dụng gói đến hết hạn.',
  })
  async cancelAutoRenew(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.subscriptionService.cancelAutoRenew(user.id);
    return buildApiResponse(
      req,
      'SUBSCRIPTION_CANCELLED',
      'Đã tắt tự động gia hạn. Bạn vẫn dùng gói đến hết ngày hết hạn.',
      data,
    );
  }

  @Post('subscriptions/resume')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bật lại tự động gia hạn' })
  async resumeAutoRenew(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.subscriptionService.resumeAutoRenew(user.id);
    return buildApiResponse(
      req,
      'SUBSCRIPTION_RESUMED',
      'Đã bật lại tự động gia hạn.',
      data,
    );
  }
}
