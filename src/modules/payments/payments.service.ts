import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { UserTier, OrderStatus, Order, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { createWithUniqueOrderCode } from '../../common/utils/order-code.util';
import { CheckoutDto } from './dto/checkout.dto';
import { MailService } from '../mail/mail.service';

const TIER_PRICES: Record<UserTier, number> = {
  FREE: 0,
  MEMBER: 99000,
  VIP: 299000,
};

/** Link thanh toán coi như hết hiệu lực sau 24h; tạo lại link mới khi user quay lại. */
const CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;

interface CheckoutLinkResult {
  checkoutUrl: string;
  extra?: Record<string, unknown>;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Tạo liên kết thanh toán cho một trong hai loại đơn:
   * - Nâng cấp gói: truyền `targetTier`, service tự tạo Order mới.
   * - Đơn sản phẩm: truyền `orderId` của Order đã tạo qua `POST /orders`.
   */
  async createCheckoutLink(userId: string, dto: CheckoutDto) {
    const order = dto.orderId
      ? await this.resolveProductOrder(userId, dto.orderId)
      : await this.createSubscriptionOrder(userId, dto.targetTier!);

    const { checkoutUrl, extra } = await this.createSePayCheckoutLink(order);

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        paymentProvider: 'SEPAY',
        checkoutUrl,
        checkoutExpiresAt: new Date(Date.now() + CHECKOUT_TTL_MS),
      },
    });

    return {
      orderId: order.id,
      orderCode: order.orderCode,
      amount: Number(order.amount),
      targetTier: order.targetTier,
      kind: order.targetTier ? 'SUBSCRIPTION' : 'PRODUCT',
      provider: 'SEPAY',
      checkoutUrl,
      ...extra,
    };
  }

  /**
   * Đơn sản phẩm đã tồn tại: chỉ chấp nhận đơn PENDING của chính user, và tái sử
   * dụng link cũ nếu còn hiệu lực để không tạo rác ở phía cổng thanh toán.
   */
  private async resolveProductOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng có ID ${orderId}`);
    }

    if (order.status === OrderStatus.PAID) {
      throw new BadRequestException('Đơn hàng này đã được thanh toán.');
    }

    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        `Không thể thanh toán đơn hàng ở trạng thái ${order.status}.`,
      );
    }

    if (order.items.length === 0 && !order.targetTier) {
      throw new BadRequestException('Đơn hàng không có sản phẩm nào.');
    }

    if (Number(order.amount) <= 0) {
      throw new BadRequestException('Giá trị đơn hàng không hợp lệ.');
    }

    return order;
  }

  private async createSubscriptionOrder(userId: string, targetTier: UserTier) {
    if (targetTier === UserTier.FREE) {
      throw new BadRequestException('Không thể tạo thanh toán cho gói FREE.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    if (user.tier === targetTier) {
      throw new BadRequestException(`Bạn đang ở gói ${targetTier} rồi.`);
    }

    return createWithUniqueOrderCode((orderCode) =>
      this.prisma.order.create({
        data: {
          orderCode,
          userId,
          targetTier,
          amount: TIER_PRICES[targetTier],
          status: OrderStatus.PENDING,
        },
      }),
    );
  }

  private buildOrderDescription(order: Order) {
    return order.targetTier
      ? `Nang cap tai khoan FashionAI goi ${order.targetTier}`
      : `Thanh toan don hang FashionAI #${order.orderCode}`;
  }

  private async createSePayCheckoutLink(
    order: Order,
  ): Promise<CheckoutLinkResult> {
    const amount = Number(order.amount);
    const orderCode = order.orderCode;
    const invoiceNumber = `FAI${orderCode}`;

    const merchant = this.configService.get<string>('SEPAY_MERCHANT_ID');
    const secretKey = this.configService.get<string>('SEPAY_SECRET_KEY');
    const checkoutBaseUrl = this.configService.get<string>(
      'SEPAY_CHECKOUT_URL',
      'https://pay-sandbox.sepay.vn/v1/checkout/init',
    );
    const successUrl = this.configService.get<string>(
      'SEPAY_SUCCESS_URL',
      'http://localhost:3000/orders/success',
    );
    const errorUrl = this.configService.get<string>(
      'SEPAY_ERROR_URL',
      'http://localhost:3000/checkout/error',
    );
    const cancelUrl = this.configService.get<string>(
      'SEPAY_CANCEL_URL',
      'http://localhost:3000/checkout',
    );

    if (!merchant || !secretKey) {
      throw new BadRequestException(
        'SePay credentials are missing. Please configure SEPAY_MERCHANT_ID and SEPAY_SECRET_KEY.',
      );
    }

    const fields: Record<string, string> = {
      order_amount: String(amount),
      merchant,
      currency: 'VND',
      operation: 'PURCHASE',
      order_description: this.buildOrderDescription(order),
      order_invoice_number: invoiceNumber,
      customer_id: order.userId,
      payment_method: 'BANK_TRANSFER',
      success_url: successUrl,
      error_url: errorUrl,
      cancel_url: cancelUrl,
    };
    const signature = this.signSePayFields(fields, secretKey);
    const signedFields = { ...fields, signature };
    const checkoutUrl = `${checkoutBaseUrl}?${new URLSearchParams(signedFields).toString()}`;

    return {
      checkoutUrl,
      extra: {
        invoiceNumber,
        formAction: checkoutBaseUrl,
        formMethod: 'POST',
        formFields: signedFields,
      },
    };
  }

  async handleSePayIPN(
    ipnData: any,
    headers: Record<string, any>,
    rawBody?: Buffer,
  ) {
    // Verify HMAC signature for all environments (mandatory in production)
    this.verifySePayIPNSignature(headers, rawBody);

    const notificationType = ipnData?.notification_type;
    const invoiceNumber = ipnData?.order?.order_invoice_number;
    const transactionId = ipnData?.transaction?.transaction_id ?? ipnData?.transaction?.id;
    const amount = Number(
      ipnData?.transaction?.transaction_amount ?? ipnData?.order?.order_amount,
    );

    if (!invoiceNumber) {
      throw new BadRequestException('Missing SePay order_invoice_number');
    }

    const orderCode = this.parseSePayOrderCode(invoiceNumber);
    if (!orderCode) {
      throw new BadRequestException(`Invalid SePay invoice number: ${invoiceNumber}`);
    }

    if (notificationType === 'TRANSACTION_VOID') {
      await this.markOrderCancelled(orderCode, 'SEPAY', ipnData);
      return { success: true, message: 'SePay transaction void processed' };
    }

    if (notificationType !== 'ORDER_PAID') {
      return { success: true, message: 'SePay notification ignored' };
    }

    await this.processOrderSuccess(
      orderCode,
      'SEPAY',
      { ...ipnData, reference: transactionId },
      amount,
    );
    return { success: true };
  }

  async handleSePayBankWebhook(
    payload: any,
    headers: Record<string, any>,
    rawBody?: Buffer,
  ) {
    this.verifySePayHmac(headers, rawBody);

    const transactionId = String(payload.id ?? '');
    if (!transactionId) {
      throw new BadRequestException('Missing SePay webhook id');
    }

    if (payload.transferType !== 'in') {
      return { success: true };
    }

    const orderCode = this.parseSePayPaymentCode(payload.code, payload.content);
    if (!orderCode) {
      throw new BadRequestException('Missing or invalid SePay payment code');
    }

    await this.processOrderSuccess(
      orderCode,
      'SEPAY_WEBHOOK',
      { ...payload, reference: transactionId },
      Number(payload.transferAmount),
    );
    return { success: true };
  }

  private signSePayFields(fields: Record<string, string>, secretKey: string) {
    const allowedFields = [
      'order_amount',
      'merchant',
      'currency',
      'operation',
      'order_description',
      'order_invoice_number',
      'customer_id',
      'payment_method',
      'success_url',
      'error_url',
      'cancel_url',
    ];

    const signedString = allowedFields
      .filter((field) => fields[field] !== undefined)
      .map((field) => `${field}=${fields[field]}`)
      .join(',');

    return crypto
      .createHmac('sha256', secretKey)
      .update(signedString)
      .digest('base64');
  }

  private verifySePayIPNSignature(headers: Record<string, any>, rawBody?: Buffer) {
    const secret = this.configService.get<string>('SEPAY_IPN_SECRET');
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const isProduction = nodeEnv === 'production';

    if (!secret) {
      if (isProduction) {
        throw new BadRequestException('SEPAY_IPN_SECRET is required in production');
      }
      this.logger.warn('SEPAY_IPN_SECRET not configured, skipping signature verification (non-production)');
      return;
    }

    const signature = headers['x-sepay-signature'] || headers['x-signature'];
    const timestamp = headers['x-sepay-timestamp'] || headers['x-timestamp'];

    if (!signature || !timestamp) {
      throw new BadRequestException('Missing SePay IPN signature or timestamp headers');
    }

    if (!rawBody) {
      throw new BadRequestException('Raw body required for SePay IPN signature verification');
    }

    const timestampNumber = Number(timestamp);
    if (!Number.isFinite(timestampNumber)) {
      throw new BadRequestException('Invalid SePay IPN timestamp');
    }

    const toleranceSeconds = Number(
      this.configService.get<string>('SEPAY_IPN_TIMESTAMP_TOLERANCE_SECONDS') ?? '300',
    );
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestampNumber) > toleranceSeconds) {
      throw new BadRequestException('SePay IPN timestamp expired');
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');

    const expected = Buffer.from(expectedSignature);
    const provided = Buffer.from(String(signature).replace(/^sha256=/, ''));
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      throw new BadRequestException('SePay IPN signature is invalid');
    }
  }

  private verifySePayHmac(headers: Record<string, any>, rawBody?: Buffer) {
    const secret = this.configService.get<string>('SEPAY_WEBHOOK_SECRET');
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const isProduction = nodeEnv === 'production';

    if (!secret) {
      if (isProduction) {
        throw new BadRequestException('SEPAY_WEBHOOK_SECRET is required in production');
      }
      this.logger.warn('SEPAY_WEBHOOK_SECRET not configured, skipping HMAC verification (non-production)');
      return;
    }

    const signature = headers['x-sepay-signature'];
    const timestamp = headers['x-sepay-timestamp'];

    if (!signature || !timestamp) {
      throw new BadRequestException('Missing SePay HMAC signature or timestamp headers');
    }

    if (!rawBody) {
      throw new BadRequestException('Raw body required for SePay HMAC verification');
    }

    const timestampNumber = Number(timestamp);
    if (!Number.isFinite(timestampNumber)) {
      throw new BadRequestException('Invalid SePay HMAC timestamp');
    }

    const toleranceSeconds = Number(
      this.configService.get<string>('SEPAY_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS') ?? '300',
    );
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestampNumber) > toleranceSeconds) {
      throw new BadRequestException('SePay webhook timestamp expired');
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');

    const expected = Buffer.from(expectedSignature);
    const provided = Buffer.from(String(signature).replace(/^sha256=/, ''));
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      throw new BadRequestException('SePay HMAC signature is invalid');
    }
  }

  private parseSePayOrderCode(invoiceNumber: string) {
    const match = invoiceNumber.match(/^FAI(\d+)$/);
    return match ? Number(match[1]) : null;
  }

  private parseSePayPaymentCode(code?: string | null, content?: string | null) {
    const codeMatch = typeof code === 'string' ? code.match(/^FAI(\d+)$/) : null;
    if (codeMatch) return Number(codeMatch[1]);

    const contentMatch =
      typeof content === 'string' ? content.match(/\bFAI(\d+)\b/) : null;
    return contentMatch ? Number(contentMatch[1]) : null;
  }

  private async markOrderCancelled(orderCode: number, provider: string, paymentData: any) {
    const order = await this.prisma.order.findUnique({ where: { orderCode } });
    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng mã ${orderCode}`);
    }

    if (order.status !== OrderStatus.PENDING) {
      return { message: 'Order is not pending' };
    }

    await this.prisma.$transaction([
      this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CANCELLED },
      }),
      this.prisma.payment.create({
        data: {
          orderId: order.id,
          provider,
          transactionId: String(paymentData?.transaction?.transaction_id ?? Date.now()),
          paymentData,
        },
      }),
    ]);
  }


  /**
   * @param paidAmount Số tiền cổng thanh toán báo đã nhận. Truyền vào để chặn
   * trường hợp người dùng can thiệp số tiền ở phía gateway; bỏ qua khi provider
   * không cung cấp (ví dụ mock sandbox).
   */
  private async processOrderSuccess(
    orderCode: number,
    provider: string,
    paymentData: any,
    paidAmount?: number,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { orderCode },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng mã ${orderCode}`);
    }

    if (
      paidAmount !== undefined &&
      (!Number.isFinite(paidAmount) || paidAmount !== Number(order.amount))
    ) {
      this.logger.warn(
        `Số tiền không khớp cho đơn #${orderCode} | provider=${provider} | expected=${Number(order.amount)} | received=${paidAmount}`,
      );
      throw new BadRequestException(
        'Số tiền thanh toán không khớp với giá trị đơn hàng.',
      );
    }

    if (order.status === OrderStatus.PAID) {
      this.logger.log(`Đơn hàng #${orderCode} đã được xử lý trước đó.`);
      return { message: 'Order already processed' };
    }

    // Đơn đã hủy/hết hạn không được âm thầm chuyển sang PAID: tiền đã vào thì cần
    // người vận hành xử lý hoàn, không phải giao hàng.
    if (order.status !== OrderStatus.PENDING) {
      this.logger.warn(
        `Nhận thanh toán cho đơn #${orderCode} ở trạng thái ${order.status} | provider=${provider}`,
      );
      throw new BadRequestException(
        `Đơn hàng #${orderCode} đang ở trạng thái ${order.status}, không thể ghi nhận thanh toán.`,
      );
    }

    const isSubscription = Boolean(order.targetTier);

    const transactionSteps: Prisma.PrismaPromise<any>[] = [
      this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.PAID,
          // Link đã dùng xong, không cho tái sử dụng.
          checkoutUrl: null,
          checkoutExpiresAt: null,
        },
      }),
      this.prisma.payment.create({
        data: {
          orderId: order.id,
          provider,
          transactionId: String(paymentData?.transId ?? paymentData?.reference ?? Date.now()),
          paymentData,
        },
      }),
    ];

    if (order.targetTier) {
      transactionSteps.push(
        this.prisma.user.update({
          where: { id: order.userId },
          data: { tier: order.targetTier },
        }),
      );
    } else {
      // Đơn sản phẩm: trừ tồn kho khi đã xác nhận thanh toán. Trừ tại đây (không
      // phải lúc tạo đơn PENDING) để đơn bỏ dở không giữ chỗ hàng vô thời hạn.
      for (const item of order.items ?? []) {
        transactionSteps.push(
          this.prisma.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: item.quantity } },
          }),
        );
      }
    }

    try {
      await this.prisma.$transaction(transactionSteps);
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(
          `Duplicate payment ignored | provider=${provider} | transaction=${paymentData?.reference ?? paymentData?.transId}`,
        );
        return { message: 'Payment already processed' };
      }
      throw err;
    }

    if (isSubscription) {
      this.logger.log(
        `Đã nâng cấp thành công User ${order.userId} lên gói ${order.targetTier} qua ${provider}`,
      );
      return { message: 'Payment processed and user tier updated successfully' };
    }

    // Gửi email xác nhận đơn hàng cho user. Không để lỗi email làm hỏng luồng
    // thanh toán (đã ghi PAID thành công rồi).
    await this.sendOrderConfirmationEmail(order.id).catch((err) =>
      this.logger.error(
        `Không gửi được email xác nhận đơn #${orderCode}: ${err?.message}`,
      ),
    );

    this.logger.log(
      `Đã ghi nhận thanh toán đơn hàng #${orderCode} của User ${order.userId} qua ${provider}`,
    );
    return { message: 'Payment processed and order marked as paid' };
  }

  /** Lấy đơn kèm sản phẩm + email user và gửi mail xác nhận. */
  private async sendOrderConfirmationEmail(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
        user: { select: { email: true } },
      },
    });

    if (!order?.user?.email || !order.items?.length) {
      return;
    }

    const itemsTotal = order.items.reduce(
      (sum, item) => sum + Number(item.price) * item.quantity,
      0,
    );

    await this.mailService.sendOrderConfirmationEmail(order.user.email, {
      orderId: order.id,
      orderCode: order.orderCode,
      items: order.items.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
        size: item.size,
        color: item.color,
        price: Number(item.price),
      })),
      itemsTotal,
      shippingFee: Number(order.shippingFee ?? 0),
      discountAmount: Number(order.discountAmount ?? 0),
      total: Number(order.amount),
      shippingInfo: order.shippingInfo as {
        name?: string;
        phone?: string;
        address?: string;
        note?: string;
      } | null,
    });
  }

  async getUserOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      include: { payments: true, items: { include: { product: true } } },
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
