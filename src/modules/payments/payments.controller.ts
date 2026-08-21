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
import { PaymentsService } from './payments.service';

@ApiTags('Payments & Subscriptions')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

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
    return {
      success: true,
      code: 'PAYMENT_CHECKOUT_CREATED',
      message: 'Tạo liên kết thanh toán thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data,
    };
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhận webhook thanh toán từ PayOS' })
  async webhook(@Body() webhookData: any) {
    return this.paymentsService.handleWebhook(webhookData);
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

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Xem lịch sử đơn thanh toán của tôi' })
  async getMyOrders(@Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const data = await this.paymentsService.getUserOrders(user.id);
    return {
      success: true,
      code: 'USER_ORDERS_SUCCESS',
      message: 'Lấy danh sách đơn hàng thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data,
    };
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
    return {
      success: true,
      code: 'MOCK_PAYMENT_SUCCESS',
      message: 'Giả lập thanh toán thành công',
      timestamp: new Date().toISOString(),
      path: req.originalUrl ?? req.url,
      data: result,
    };
  }
}
