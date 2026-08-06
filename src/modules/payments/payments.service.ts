import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { UserTier, OrderStatus } from '@prisma/client';
import PayOS from '@payos/node';
import axios from 'axios';
import * as crypto from 'crypto';

const TIER_PRICES: Record<UserTier, number> = {
  FREE: 0,
  MEMBER: 99000,
  VIP: 299000,
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private payos: PayOS | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const clientId = this.configService.get<string>('PAYOS_CLIENT_ID');
    const apiKey = this.configService.get<string>('PAYOS_API_KEY');
    const checksumKey = this.configService.get<string>('PAYOS_CHECKSUM_KEY');

    if (clientId && apiKey && checksumKey) {
      this.payos = new PayOS(clientId, apiKey, checksumKey);
      this.logger.log('PayOS service successfully initialized');
    } else {
      this.logger.warn('PayOS credentials missing in .env. Payment link generation will run in sandbox mock mode.');
    }
  }

  async createCheckoutLink(userId: string, targetTier: UserTier, provider: 'PAYOS' | 'MOMO' = 'MOMO') {
    if (targetTier === UserTier.FREE) {
      throw new BadRequestException('Không thể tạo thanh toán cho gói FREE.');
    }

    if (provider === 'MOMO') {
      return this.createMoMoCheckoutLink(userId, targetTier);
    }

    return this.createPayOSCheckoutLink(userId, targetTier);
  }

  private async createPayOSCheckoutLink(userId: string, targetTier: UserTier) {
    const amount = TIER_PRICES[targetTier];
    const orderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 100));

    const order = await this.prisma.order.create({
      data: {
        orderCode,
        userId,
        targetTier,
        amount,
        status: OrderStatus.PENDING,
      },
    });

    const returnUrl = this.configService.get<string>('PAYOS_RETURN_URL', 'http://localhost:3000/orders/success');
    const cancelUrl = this.configService.get<string>('PAYOS_CANCEL_URL', 'http://localhost:3000/checkout');

    let checkoutUrl = '';

    if (this.payos) {
      try {
        const paymentLinkRes = await this.payos.createPaymentLink({
          orderCode,
          amount,
          description: `Nang cap ${targetTier}`,
          returnUrl,
          cancelUrl,
        });
        checkoutUrl = paymentLinkRes.checkoutUrl;
      } catch (err: any) {
        this.logger.error(`PayOS create payment link failed: ${err.message}`);
        throw new BadRequestException(`Không thể tạo liên kết thanh toán PayOS: ${err.message}`);
      }
    } else {
      checkoutUrl = `http://localhost:3000/api/payments/mock-success?orderCode=${orderCode}`;
    }

    return {
      orderId: order.id,
      orderCode,
      amount,
      targetTier,
      provider: 'PAYOS',
      checkoutUrl,
    };
  }

  private async createMoMoCheckoutLink(userId: string, targetTier: UserTier) {
    const amount = TIER_PRICES[targetTier];
    const orderCode = Number(String(Date.now()).slice(-6) + Math.floor(Math.random() * 100));
    const orderId = `MOMO_${orderCode}_${Date.now()}`;
    const requestId = orderId;

    const order = await this.prisma.order.create({
      data: {
        orderCode,
        userId,
        targetTier,
        amount,
        status: OrderStatus.PENDING,
      },
    });

    const partnerCode = this.configService.get<string>('MOMO_PARTNER_CODE', 'MOMO');
    const accessKey = this.configService.get<string>('MOMO_ACCESS_KEY', 'F8BBA842ECF81');
    const secretKey = this.configService.get<string>('MOMO_SECRET_KEY', 'K951B6FA292D6C6F2B57B2F6A1715424D');
    const endpoint = this.configService.get<string>('MOMO_ENDPOINT', 'https://test-payment.momo.vn/v2/gateway/api/create');
    const redirectUrl = this.configService.get<string>('MOMO_REDIRECT_URL', 'http://localhost:3000/orders/success');
    const ipnUrl = this.configService.get<string>('MOMO_IPN_URL', 'http://localhost:3000/api/payments/momo-ipn');
    const orderInfo = `Nâng cấp tài khoản FashionAI gói ${targetTier}`;
    const requestType = 'captureWallet';
    const extraData = Buffer.from(JSON.stringify({ userId, orderCode })).toString('base64');

    // Create raw signature string for MoMo v2 API
    const rawSignature = `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}&ipnUrl=${ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}&partnerCode=${partnerCode}&redirectUrl=${redirectUrl}&requestId=${requestId}&requestType=${requestType}`;
    const signature = crypto.createHmac('sha256', secretKey).update(rawSignature).digest('hex');

    const requestBody = {
      partnerCode,
      partnerName: 'FashionAI',
      storeId: 'FashionAIStore',
      requestId,
      amount,
      orderId,
      orderInfo,
      redirectUrl,
      ipnUrl,
      lang: 'vi',
      requestType,
      autoCapture: true,
      extraData,
      signature,
    };

    let checkoutUrl = '';

    try {
      this.logger.log(`Calling MoMo API: ${endpoint}`);
      const res = await axios.post(endpoint, requestBody, { timeout: 15000 });
      if (res.data?.payUrl) {
        checkoutUrl = res.data.payUrl;
      } else {
        this.logger.warn(`MoMo returned message: ${res.data?.message}. Fallback to mock link.`);
        checkoutUrl = `http://localhost:3000/api/payments/mock-success?orderCode=${orderCode}`;
      }
    } catch (err: any) {
      this.logger.warn(`MoMo Sandbox connection failed (${err.message}). Fallback to mock link.`);
      checkoutUrl = `http://localhost:3000/api/payments/mock-success?orderCode=${orderCode}`;
    }

    return {
      orderId: order.id,
      orderCode,
      amount,
      targetTier,
      provider: 'MOMO',
      checkoutUrl,
      momoOrderId: orderId,
    };
  }

  async handleWebhook(webhookData: any) {
    this.logger.log(`PayOS Webhook received: ${JSON.stringify(webhookData)}`);

    let data = webhookData;
    if (this.payos && webhookData?.data) {
      try {
        data = this.payos.verifyPaymentWebhookData(webhookData);
      } catch (err: any) {
        this.logger.warn(`PayOS webhook checksum verification failed: ${err.message}`);
        throw new BadRequestException('PayOS webhook signature is invalid');
      }
    }

    const orderCode = data?.orderCode ?? data?.data?.orderCode;
    if (!orderCode) {
      throw new BadRequestException('Thiếu thông tin orderCode trong webhook');
    }

    return this.processOrderSuccess(Number(orderCode), 'PAYOS', data);
  }

  async handleMoMoIPN(ipnData: any) {
    this.logger.log(`MoMo IPN Webhook received: ${JSON.stringify(ipnData)}`);

    const { resultCode, orderId, extraData, transId } = ipnData;

    let orderCodeNum: number | null = null;

    if (extraData) {
      try {
        const decoded = JSON.parse(Buffer.from(extraData, 'base64').toString('utf-8'));
        orderCodeNum = decoded.orderCode;
      } catch (e) {}
    }

    if (!orderCodeNum && orderId) {
      const parts = orderId.split('_');
      if (parts.length >= 2) {
        orderCodeNum = Number(parts[1]);
      }
    }

    if (!orderCodeNum) {
      throw new BadRequestException('Không thể xác định orderCode từ MoMo IPN');
    }

    if (Number(resultCode) !== 0) {
      this.logger.warn(`MoMo IPN giao dịch thất bại/hủy (resultCode: ${resultCode})`);
      return { message: 'MoMo transaction not successful', resultCode };
    }

    return this.processOrderSuccess(orderCodeNum, 'MOMO', { ...ipnData, transId });
  }

  private async processOrderSuccess(orderCode: number, provider: string, paymentData: any) {
    const order = await this.prisma.order.findUnique({
      where: { orderCode },
    });

    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng mã ${orderCode}`);
    }

    if (order.status === OrderStatus.PAID) {
      this.logger.log(`Đơn hàng #${orderCode} đã được xử lý trước đó.`);
      return { message: 'Order already processed' };
    }

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PAID },
      }),
      this.prisma.payment.create({
        data: {
          orderId: order.id,
          provider,
          transactionId: String(paymentData?.transId ?? paymentData?.reference ?? Date.now()),
          paymentData,
        },
      }),
      this.prisma.user.update({
        where: { id: order.userId },
        data: { tier: order.targetTier },
      }),
    ]);

    this.logger.log(`Đã nâng cấp thành công User ${order.userId} lên gói ${order.targetTier} qua ${provider}`);
    return { message: 'Payment processed and user tier updated successfully' };
  }

  async getUserOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      include: { payments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async mockSuccess(orderCode: number) {
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException('Mock payment endpoint is disabled in production.');
    }
    return this.processOrderSuccess(orderCode, 'MOCK_SANDBOX', { mock: true });
  }
}
