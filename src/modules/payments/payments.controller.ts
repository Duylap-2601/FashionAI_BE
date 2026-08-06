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
  @ApiOperation({ summary: 'Tạo link thanh toán nâng cấp tài khoản (MoMo / PayOS)' })
  async checkout(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CheckoutDto,
  ) {
    const data = await this.paymentsService.createCheckoutLink(
      user.id,
      dto.targetTier,
      dto.provider ?? 'MOMO',
    );
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
  @ApiOperation({ summary: 'Nhận Webhook xử lý giao dịch từ PayOS' })
  async webhook(@Body() webhookData: any) {
    return this.paymentsService.handleWebhook(webhookData);
  }

  @Public()
  @Post('momo-ipn')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhận IPN Webhook xử lý giao dịch từ MoMo' })
  async momoIPN(@Body() ipnData: any) {
    return this.paymentsService.handleMoMoIPN(ipnData);
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Xem danh sách lịch sử đơn hàng của tôi' })
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
  @ApiOperation({ summary: 'Mock thanh toán thành công (Dev/Testing Mode)' })
  async mockSuccess(@Req() req: Request, @Query('orderCode') orderCode: number) {
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
