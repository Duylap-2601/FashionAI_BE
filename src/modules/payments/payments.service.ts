import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { UserTier, OrderStatus, Order, Prisma, PaymentStatus, RefundStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { createWithUniqueOrderCode } from '../../common/utils/order-code.util';
import { CheckoutDto } from './dto/checkout.dto';
import { ConfirmManualPaymentDto } from './dto/confirm-manual-payment.dto';
import { MomoIpnDto } from './dto/momo-ipn.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { MomoPaymentProvider } from './momo/momo-payment.provider';
import { MOMO_PROVIDER, MOMO_SUCCESS_RESULT_CODE } from './momo/momo.constants';
import { MailQueueService } from '../mail/mail-queue.service';
import { NotificationService } from '../notification/notification.service';
import { SubscriptionService } from './subscription.service';
import { OutboxService } from '../outbox/services/outbox.service';
import { OUTBOX_EVENT_TYPE } from '../outbox/constants/outbox.constants';
import {
  TIER_PRICES,
  RENEWAL_REMINDER_DAYS_BEFORE,
} from '../../common/constants/subscription-plans.constants';

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
    private readonly mailQueueService: MailQueueService,
    private readonly notificationService: NotificationService,
    private readonly subscriptionService: SubscriptionService,
    private readonly outboxService: OutboxService,
    private readonly momoPaymentProvider: MomoPaymentProvider,
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

    if (dto.provider === 'SEPAY') {
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

    return this.createMomoCheckoutLink(order);
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

    const payableStatuses: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.PENDING_PAYMENT];
    if (!payableStatuses.includes(order.status)) {
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

    if (order.items.length > 0) {
      const snapshot = order.shippingAddressSnapshot ?? order.shippingInfo;
      const info = snapshot as { address?: string; phone?: string; ghnDistrictId?: number; ghnWardCode?: string } | null;
      if (!info?.address || !info?.phone || !info?.ghnDistrictId || !info?.ghnWardCode) {
        throw new BadRequestException('Đơn hàng thiếu địa chỉ giao hàng hợp lệ. Vui lòng liên hệ hỗ trợ hoặc hủy và đặt lại nếu còn đủ điều kiện.');
      }
      if (!order.shippingAddressSnapshot && order.shippingInfo) {
        await this.prisma.order.update({ where: { id: order.id }, data: { shippingAddressSnapshot: order.shippingInfo as Prisma.InputJsonValue } });
      }
    }

    return order;
  }

  private async createSubscriptionOrder(userId: string, targetTier: UserTier) {
    if (targetTier === UserTier.FREE) {
      throw new BadRequestException(
        'Không thể tạo thanh toán cho gói FREE. Dùng /payments/subscriptions/cancel để không gia hạn.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    // Check for existing SCHEDULED sub (prevents stacking)
    const scheduledSub = await this.prisma.subscription.findFirst({
      where: { userId, status: 'SCHEDULED' },
    });

    if (scheduledSub) {
      throw new ConflictException(
        `Bạn đã có gói ${scheduledSub.tier} được hẹn kích hoạt vào ${scheduledSub.startsAt.toLocaleDateString('vi-VN')}. Vui lòng huỷ trước khi đổi gói.`,
      );
    }

    return createWithUniqueOrderCode((orderCode) =>
      this.prisma.order.create({
        data: {
          orderCode,
          userId,
          targetTier,
          amount: TIER_PRICES[targetTier],
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.PENDING,
        },
      }),
    );
  }

  /**
   * SePay redirect thẳng về success_url/error_url/cancel_url không kèm thêm
   * tham số nào của riêng đơn hàng, nên FE không biết đơn nào vừa thanh toán.
   * Nhúng sẵn orderCode + status vào URL trước khi ký để FE tra được đúng đơn.
   */
  private appendOrderCodeParam(
    baseUrl: string,
    orderCode: number,
    status: 'success' | 'error' | 'cancel',
  ) {
    const url = new URL(baseUrl);
    url.searchParams.set('orderCode', String(orderCode));
    url.searchParams.set('status', status);
    return url.toString();
  }

  private buildOrderDescription(order: Order) {
    const invoiceNumber = `FAI${order.orderCode}`;
    return order.targetTier
      ? `Nang cap tai khoan FashionAI goi ${order.targetTier} ${invoiceNumber}`
      : `Thanh toan don hang FashionAI ${invoiceNumber}`;
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
    const successUrl = this.appendOrderCodeParam(
      this.configService.get<string>('SEPAY_SUCCESS_URL', 'http://localhost:3000/orders/success'),
      orderCode,
      'success',
    );
    const errorUrl = this.appendOrderCodeParam(
      this.configService.get<string>('SEPAY_ERROR_URL', 'http://localhost:3000/checkout/error'),
      orderCode,
      'error',
    );
    const cancelUrl = this.appendOrderCodeParam(
      this.configService.get<string>('SEPAY_CANCEL_URL', 'http://localhost:3000/checkout'),
      orderCode,
      'cancel',
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

  private async createMomoCheckoutLink(order: Order) {
    const amount = Math.trunc(Number(order.amount));
    const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MS);
    const existingPayment = await this.prisma.payment.findFirst({
      where: {
        orderId: order.id,
        provider: MOMO_PROVIDER,
        status: PaymentStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    const payment = existingPayment ?? await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: MOMO_PROVIDER,
        providerPaymentId: this.buildMomoProviderOrderId(order.orderCode),
        idempotencyKey: crypto.randomUUID(),
        amountVnd: BigInt(amount),
        currency: 'VND',
        expiresAt,
        paymentData: { createdFor: order.targetTier ? 'SUBSCRIPTION' : 'PRODUCT' },
      },
    });

    const providerOrderId = payment.providerPaymentId!;
    const requestId = payment.idempotencyKey!;
    const extraData = Buffer.from(JSON.stringify({ paymentId: payment.id, orderId: order.id })).toString('base64');
    const redirectUrl = new URL(this.configService.get<string>('MOMO_REDIRECT_URL', 'http://localhost:3000/payment/result'));
    redirectUrl.searchParams.set('paymentId', payment.id);
    const providerResponse = await this.momoPaymentProvider.createPayment({
      amount,
      orderId: providerOrderId,
      requestId,
      orderInfo: this.buildOrderDescription(order),
      extraData,
      redirectUrl: redirectUrl.toString(),
    });
    const checkoutUrl = String(providerResponse.payUrl ?? providerResponse.deeplink ?? providerResponse.qrCodeUrl ?? '');
    if (!checkoutUrl) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          failedAt: new Date(),
          failureReason: 'MoMo create payment response did not include a redirect artifact',
          paymentData: providerResponse as Prisma.InputJsonValue,
        },
      });
      throw new BadRequestException('MoMo không trả về link thanh toán. Vui lòng thử lại sau.');
    }

    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          paymentData: {
            providerResponse,
            payUrl: providerResponse.payUrl,
            deeplink: providerResponse.deeplink,
            qrCodeUrl: providerResponse.qrCodeUrl,
          } as Prisma.InputJsonValue,
        },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: order.status === OrderStatus.PENDING_PAYMENT ? OrderStatus.PENDING : order.status,
          paymentProvider: MOMO_PROVIDER,
          checkoutUrl,
          checkoutExpiresAt: expiresAt,
        },
      }),
    ]);

    return {
      orderId: order.id,
      orderCode: order.orderCode,
      paymentId: payment.id,
      amount,
      targetTier: order.targetTier,
      kind: order.targetTier ? 'SUBSCRIPTION' : 'PRODUCT',
      provider: MOMO_PROVIDER,
      checkoutUrl,
      payUrl: providerResponse.payUrl,
      deeplink: providerResponse.deeplink,
      qrCodeUrl: providerResponse.qrCodeUrl,
      extra: { providerOrderId, requestId },
    };
  }

  private buildMomoProviderOrderId(orderCode: number) {
    return `MOMO_${orderCode}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  }

  async handleMomoIPN(payload: MomoIpnDto & Record<string, unknown>) {
    this.momoPaymentProvider.verifyIpn(payload);
    const transId = payload.transId === undefined || payload.transId === null ? '' : String(payload.transId);
    const eventKey = `MOMO:${payload.orderId}:${payload.requestId}:${payload.resultCode}:${transId}`;

    const payment = await this.prisma.payment.findFirst({
      where: { provider: MOMO_PROVIDER, providerPaymentId: payload.orderId },
      include: { order: true },
    });

    if (!payment) {
      await this.recordWebhookFailure(MOMO_PROVIDER, 'PAYMENT_NOT_FOUND', `Không tìm thấy MoMo payment ${payload.orderId}`, payload);
      throw new NotFoundException('MoMo payment not found');
    }

    if (payment.idempotencyKey !== payload.requestId) {
      await this.recordWebhookFailure(MOMO_PROVIDER, 'REQUEST_ID_MISMATCH', `MoMo requestId không khớp cho payment ${payment.id}`, payload, payment.order.orderCode);
      throw new BadRequestException('MoMo requestId mismatch');
    }

    if (Number(payment.amountVnd ?? payment.order.amount) !== Number(payload.amount)) {
      await this.recordWebhookFailure(MOMO_PROVIDER, 'AMOUNT_MISMATCH', `MoMo amount không khớp cho payment ${payment.id}`, payload, payment.order.orderCode);
      throw new BadRequestException('MoMo amount mismatch');
    }

    try {
      await this.prisma.webhookEvent.create({
        data: {
          provider: MOMO_PROVIDER,
          eventKey,
          providerEventId: eventKey,
          providerOrderCode: payload.orderId,
          eventType: 'PAYMENT_IPN',
          status: 'PROCESSING',
          payload: payload as Prisma.InputJsonValue,
          signatureValid: true,
          orderId: payment.orderId,
          paymentId: payment.id,
          processedAt: null,
          attemptCount: 1,
        },
      });
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { resultCode: 0, message: 'Duplicate IPN acknowledged' };
      }
      throw err;
    }

    try {
      if (payload.resultCode === MOMO_SUCCESS_RESULT_CODE) {
        if (!transId) {
          throw new BadRequestException('MoMo success IPN missing transId');
        }
        await this.processOrderSuccess(
          payment.order.orderCode,
          MOMO_PROVIDER,
          { ...payload, transId, providerOrderId: payload.orderId, paymentId: payment.id },
          Number(payload.amount),
          payment.id,
        );
      } else if (payment.status === PaymentStatus.PENDING) {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            failedAt: new Date(),
            failureReason: payload.message ?? `MoMo resultCode=${payload.resultCode}`,
            paymentData: payload as Prisma.InputJsonValue,
          },
        });
      }

      await this.prisma.webhookEvent.update({
        where: { eventKey },
        data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
      });
      return { resultCode: 0, message: 'Success' };
    } catch (err) {
      await this.prisma.webhookEvent.update({
        where: { eventKey },
        data: {
          status: 'FAILED_RETRYABLE',
          lastError: err instanceof Error ? err.message : String(err),
        },
      }).catch(() => undefined);
      throw err;
    }
  }

  async getPaymentStatus(userId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, order: { userId } },
      include: { order: { select: { id: true, orderCode: true, status: true, paymentStatus: true, targetTier: true } } },
    });
    if (!payment) {
      throw new NotFoundException('Không tìm thấy thanh toán');
    }

    return {
      id: payment.id,
      orderId: payment.orderId,
      orderCode: payment.order.orderCode,
      provider: payment.provider,
      status: payment.status,
      orderStatus: payment.order.status,
      paymentStatus: payment.order.paymentStatus,
      amountVnd: payment.amountVnd ? Number(payment.amountVnd) : null,
      currency: payment.currency,
      paidAt: payment.paidAt,
      failedAt: payment.failedAt,
      failureReason: payment.failureReason,
      expiresAt: payment.expiresAt,
      targetTier: payment.order.targetTier,
    };
  }

  async refundMomoPayment(paymentId: string, dto: RefundPaymentDto, adminId: string) {
    const idempotencyKey = dto.idempotencyKey ?? crypto.randomUUID();
    const existingRefund = await this.prisma.refund.findUnique({ where: { idempotencyKey } });
    if (existingRefund) {
      return this.toRefundResponse(existingRefund);
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });
    if (!payment) {
      throw new NotFoundException('Không tìm thấy thanh toán');
    }
    if (payment.provider !== MOMO_PROVIDER) {
      throw new BadRequestException('Endpoint này chỉ xử lý hoàn tiền MoMo. Dùng luồng manual cho payment legacy.');
    }
    if (payment.status !== PaymentStatus.PAID || payment.order.paymentStatus !== PaymentStatus.PAID) {
      throw new BadRequestException('Chỉ có thể hoàn tiền payment MoMo đã thanh toán.');
    }
    if (!payment.transactionId) {
      throw new BadRequestException('Payment MoMo thiếu transId gốc, không thể gọi refund.');
    }

    const amountVnd = BigInt(dto.amountVnd);
    const paidAmount = payment.amountVnd ?? payment.order.amountPaidVnd ?? BigInt(Math.round(Number(payment.order.amount)));
    const reserved = await this.prisma.refund.aggregate({
      where: {
        paymentId: payment.id,
        status: { in: [RefundStatus.PENDING, RefundStatus.PROCESSING, RefundStatus.COMPLETED] },
      },
      _sum: { amountVnd: true },
    });
    const remaining = paidAmount - (reserved._sum.amountVnd ?? BigInt(0));
    if (amountVnd > remaining) {
      throw new BadRequestException(`Số tiền hoàn vượt quá số dư có thể hoàn. Còn lại ${remaining.toString()} VND.`);
    }

    const refundOrderId = this.buildMomoRefundOrderId(payment.order.orderCode);
    const refund = await this.prisma.$transaction(async (tx) => {
      const created = await tx.refund.create({
        data: {
          orderId: payment.orderId,
          paymentId: payment.id,
          provider: MOMO_PROVIDER,
          providerRefundId: refundOrderId,
          amountVnd,
          currency: 'VND',
          reason: dto.reason,
          status: RefundStatus.PENDING,
          idempotencyKey,
          metadata: { requestedBy: adminId, originalTransId: payment.transactionId } as Prisma.InputJsonValue,
        },
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: { refundStatus: RefundStatus.PROCESSING, paymentStatus: PaymentStatus.REFUND_PENDING },
      });
      await tx.orderEvent.create({
        data: {
          orderId: payment.orderId,
          type: 'REFUND_REQUESTED',
          source: 'ADMIN',
          actorId: adminId,
          fromPaymentStatus: payment.order.paymentStatus,
          toPaymentStatus: PaymentStatus.REFUND_PENDING,
          publicMessage: 'Yêu cầu hoàn tiền đang được xử lý qua MoMo.',
          internalNote: dto.reason,
          deduplicationKey: `refund:${MOMO_PROVIDER}:${idempotencyKey}:requested`,
        },
      }).catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
        throw err;
      });
      return created;
    });

    try {
      const providerResponse = await this.momoPaymentProvider.refundPayment({
        amount: dto.amountVnd,
        orderId: refundOrderId,
        requestId: idempotencyKey,
        transId: payment.transactionId,
        description: dto.reason,
      });
      const resultCode = Number(providerResponse.resultCode);
      if (resultCode !== MOMO_SUCCESS_RESULT_CODE) {
        const failed = await this.prisma.refund.update({
          where: { id: refund.id },
          data: {
            status: RefundStatus.FAILED,
            failedReason: String(providerResponse.message ?? `MoMo refund resultCode=${providerResponse.resultCode}`),
            processedAt: new Date(),
            metadata: { providerResponse } as Prisma.InputJsonValue,
          },
        });
        await this.prisma.order.update({
          where: { id: payment.orderId },
          data: { refundStatus: RefundStatus.FAILED, paymentStatus: PaymentStatus.PAID },
        });
        return this.toRefundResponse(failed);
      }

      const updatedRefund = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.refund.update({
          where: { id: refund.id },
          data: {
            status: RefundStatus.COMPLETED,
            processedAt: new Date(),
            metadata: { providerResponse } as Prisma.InputJsonValue,
          },
        });
        const totalCompleted = await tx.refund.aggregate({
          where: { paymentId: payment.id, status: RefundStatus.COMPLETED },
          _sum: { amountVnd: true },
        });
        const refundedTotal = totalCompleted._sum.amountVnd ?? BigInt(0);
        const fullyRefunded = refundedTotal >= paidAmount;
        await tx.order.update({
          where: { id: payment.orderId },
          data: {
            amountRefundedVnd: refundedTotal,
            refundStatus: RefundStatus.COMPLETED,
            paymentStatus: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
          },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
            refundedAt: new Date(),
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: payment.orderId,
            type: 'REFUND_COMPLETED',
            source: 'PAYMENT',
            actorId: adminId,
            fromPaymentStatus: PaymentStatus.REFUND_PENDING,
            toPaymentStatus: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
            publicMessage: 'Khoản hoàn tiền đã được MoMo xác nhận.',
            internalNote: dto.reason,
            metadata: { refundId: refund.id, amountVnd: dto.amountVnd, providerRefundId: refundOrderId } as Prisma.InputJsonValue,
            deduplicationKey: `refund:${MOMO_PROVIDER}:${idempotencyKey}:completed`,
          },
        }).catch((err) => {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
          throw err;
        });
        return updated;
      });
      return this.toRefundResponse(updatedRefund);
    } catch (err) {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.PROCESSING,
          failedReason: err instanceof Error ? err.message : String(err),
        },
      }).catch(() => undefined);
      throw new ServiceUnavailableException('Chưa xác định kết quả hoàn tiền MoMo. Vui lòng query/reconcile bằng cùng idempotencyKey trước khi gửi lại.');
    }
  }

  private buildMomoRefundOrderId(orderCode: number) {
    return `MOMO_REFUND_${orderCode}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  }

  private toRefundResponse(refund: { id: string; orderId: string; paymentId: string | null; provider: string; providerRefundId: string | null; amountVnd: bigint; currency: string; reason: string | null; status: RefundStatus; idempotencyKey: string | null; requestedAt: Date; processedAt: Date | null; failedReason: string | null; metadata: Prisma.JsonValue | null }) {
    return {
      id: refund.id,
      orderId: refund.orderId,
      paymentId: refund.paymentId,
      provider: refund.provider,
      providerRefundId: refund.providerRefundId,
      amountVnd: Number(refund.amountVnd),
      currency: refund.currency,
      reason: refund.reason,
      status: refund.status,
      idempotencyKey: refund.idempotencyKey,
      requestedAt: refund.requestedAt,
      processedAt: refund.processedAt,
      failedReason: refund.failedReason,
      metadata: refund.metadata,
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
      await this.recordWebhookFailure('SEPAY_IPN', 'PARSE_FAILED', 'Missing SePay order_invoice_number', ipnData);
      throw new BadRequestException('Missing SePay order_invoice_number');
    }

    const orderCode = this.parseSePayOrderCode(invoiceNumber);
    if (!orderCode) {
      await this.recordWebhookFailure('SEPAY_IPN', 'PARSE_FAILED', `Invalid SePay invoice number: ${invoiceNumber}`, ipnData);
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
      await this.recordWebhookFailure('SEPAY_WEBHOOK', 'PARSE_FAILED', 'Missing or invalid SePay payment code', payload);
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

  /**
   * Admin xác nhận thủ công khi tiền đã vào tài khoản nhưng webhook SePay không
   * tới (lỗi mạng, IPN bị chặn, v.v). Tái dùng processOrderSuccess() để giữ
   * nguyên mọi ràng buộc của luồng webhook thật (khớp số tiền, idempotent,
   * trừ kho, tạo Payment/OrderEvent, gia hạn subscription, gửi email).
   */
  async confirmManualPayment(orderCode: number, dto: ConfirmManualPaymentDto, adminId: string) {
    const order = await this.prisma.order.findUnique({ where: { orderCode } });
    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng mã ${orderCode}`);
    }

    return this.processOrderSuccess(
      orderCode,
      'MANUAL_ADMIN',
      { reference: dto.reference, note: dto.note, confirmedBy: adminId },
      Number(order.amount),
    );
  }

  /**
   * Ghi nhận các webhook thanh toán không xử lý được (không parse ra mã đơn,
   * không tìm thấy đơn, sai số tiền, sai trạng thái) để admin chủ động phát
   * hiện giao dịch "tiền đã vào nhưng không match đơn" thay vì chỉ nằm im
   * trong log server. Best-effort: lỗi ghi log không được làm hỏng webhook.
   */
  private async recordWebhookFailure(
    provider: string,
    reason: string,
    message: string,
    rawPayload: unknown,
    orderCode?: number,
  ) {
    // Best-effort: không bao giờ được throw ra ngoài. Bao gồm cả trường hợp
    // prisma.webhookFailure undefined (ví dụ khi test mock Prisma không đầy đủ).
    try {
      await this.prisma.webhookFailure?.create({
        data: {
          provider,
          reason,
          message,
          rawPayload: (rawPayload ?? {}) as Prisma.InputJsonValue,
          orderCode,
        },
      });
    } catch (err) {
      this.logger.error(`Không ghi được webhook failure: ${(err as Error)?.message}`);
    }
  }

  async listWebhookFailures(resolved?: boolean) {
    return this.prisma.webhookFailure.findMany({
      where: resolved === undefined ? undefined : { resolved },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markWebhookFailureResolved(id: string) {
    const failure = await this.prisma.webhookFailure.findUnique({ where: { id } });
    if (!failure) {
      throw new NotFoundException(`Không tìm thấy webhook failure ${id}`);
    }
    return this.prisma.webhookFailure.update({
      where: { id },
      data: { resolved: true, resolvedAt: new Date() },
    });
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
      this.prisma.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'PAYMENT_CANCELLED',
          source: 'PAYMENT',
          fromStatus: OrderStatus.PENDING,
          toStatus: OrderStatus.CANCELLED,
          publicMessage: 'Giao dịch thanh toán đã bị hủy.',
          deduplicationKey: `payment:${provider}:${paymentData?.transaction?.transaction_id ?? Date.now()}:cancelled`,
        },
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
    existingPaymentId?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { orderCode },
      include: { items: true },
    });

    if (!order) {
      if (provider !== 'MANUAL_ADMIN') {
        await this.recordWebhookFailure(provider, 'ORDER_NOT_FOUND', `Không tìm thấy đơn hàng mã ${orderCode}`, paymentData, orderCode);
      }
      throw new NotFoundException(`Không tìm thấy đơn hàng mã ${orderCode}`);
    }

    if (
      paidAmount !== undefined &&
      (!Number.isFinite(paidAmount) || paidAmount !== Number(order.amount))
    ) {
      this.logger.warn(
        `Số tiền không khớp cho đơn #${orderCode} | provider=${provider} | expected=${Number(order.amount)} | received=${paidAmount}`,
      );
      if (provider !== 'MANUAL_ADMIN') {
        await this.recordWebhookFailure(
          provider,
          'AMOUNT_MISMATCH',
          `Số tiền không khớp cho đơn #${orderCode}: expected=${Number(order.amount)}, received=${paidAmount}`,
          paymentData,
          orderCode,
        );
      }
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
      if (provider !== 'MANUAL_ADMIN') {
        await this.recordWebhookFailure(
          provider,
          'INVALID_ORDER_STATUS',
          `Nhận thanh toán cho đơn #${orderCode} ở trạng thái ${order.status}, không thể ghi nhận thanh toán.`,
          paymentData,
          orderCode,
        );
      }
      throw new BadRequestException(
        `Đơn hàng #${orderCode} đang ở trạng thái ${order.status}, không thể ghi nhận thanh toán.`,
      );
    }

    const isSubscription = Boolean(order.targetTier);

    let subscriptionMode: 'NEW' | 'RENEWAL' | 'UPGRADE' | 'DOWNGRADE' | undefined;

    try {
      const claimed = await this.prisma.$transaction(async (tx) => {
        // Chốt trạng thái bằng chính câu UPDATE có điều kiện status=PENDING. IPN và
        // bank webhook ghi vào hai `provider` khác nhau nên unique index
        // (provider, transactionId) không chặn được chúng; nếu chỉ dựa vào lần đọc
        // ở trên thì cả hai đều thấy PENDING và trừ tồn kho hai lần cho một đơn.
        const claim = await tx.order.updateMany({
          where: { id: order.id, status: OrderStatus.PENDING },
          data: {
            status: OrderStatus.PAID,
            paymentStatus: PaymentStatus.PAID,
            amountPaidVnd: BigInt(Number(order.amount)),
            // Link đã dùng xong, không cho tái sử dụng.
            checkoutUrl: null,
            checkoutExpiresAt: null,
          },
        });

        if (claim.count === 0) return { success: false };

        if (existingPaymentId) {
          await tx.payment.update({
            where: { id: existingPaymentId },
            data: {
              status: PaymentStatus.PAID,
              transactionId: String(paymentData?.transId ?? paymentData?.reference ?? Date.now()),
              paymentData,
              paidAt: new Date(),
              failureReason: null,
            },
          });
        } else {
          await tx.payment.create({
            data: {
              orderId: order.id,
              provider,
              transactionId: String(paymentData?.transId ?? paymentData?.reference ?? Date.now()),
              paymentData,
              status: PaymentStatus.PAID,
              paidAt: new Date(),
              amountVnd: BigInt(Number(order.amount)),
            },
          });
        }

        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'PAYMENT_SUCCEEDED',
            source: 'PAYMENT',
            fromStatus: OrderStatus.PENDING,
            toStatus: OrderStatus.PAID,
            publicMessage: 'Thanh toán đã được xác minh thành công.',
            deduplicationKey: `payment:${provider}:${paymentData?.transId ?? paymentData?.reference ?? Date.now()}`,
          },
        });

        if (order.targetTier) {
          const result = await this.subscriptionService.createOrExtendSubscription(
            order.userId,
            order.targetTier,
            order.id,
            tx,
          );
          subscriptionMode = result.mode;
        }

        return { success: true, subscriptionMode };
      });

      if (!claimed?.success) {
        this.logger.log(
          `Đơn hàng #${orderCode} đã được ghi nhận bởi webhook khác | provider=${provider}`,
        );
        return { message: 'Order already processed' };
      }
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(
          `Duplicate payment ignored | provider=${provider} | transaction=${paymentData?.reference ?? paymentData?.transId}`,
        );
        return { message: 'Payment already processed' };
      }
      throw err;
    }

    // Notification realtime cho cả đơn nâng cấp gói lẫn đơn sản phẩm. Đặt SAU khi
    // đã claim PAID thành công (không rơi vào nhánh already-processed), và tách
    // riêng khỏi updateStatus() vì webhook ghi PAID trực tiếp, không đi qua đó.
    // Lỗi realtime không được làm fail webhook (tiền đã vào, đã ghi PAID).
    let subscriptionTitle = 'Nâng cấp tài khoản thành công';
    let subscriptionMessage = `Tài khoản của bạn đã được nâng cấp lên gói ${order.targetTier}.`;

    if (isSubscription) {
      if (subscriptionMode === 'RENEWAL') {
        subscriptionTitle = `Gia hạn gói ${order.targetTier} thành công`;
        subscriptionMessage = `Gói ${order.targetTier} của bạn đã được gia hạn thành công.`;
      } else if (subscriptionMode === 'UPGRADE') {
        subscriptionTitle = `Đã nâng cấp lên gói ${order.targetTier}`;
        subscriptionMessage = `Tài khoản của bạn đã được nâng cấp lên gói ${order.targetTier} và có hiệu lực ngay.`;
      } else if (subscriptionMode === 'DOWNGRADE') {
        subscriptionTitle = `Đã hẹn chuyển sang gói ${order.targetTier}`;
        subscriptionMessage = `Yêu cầu chuyển gói của bạn đã được ghi nhận. Gói ${order.targetTier} sẽ được kích hoạt khi gói hiện tại kết thúc.`;
      }
    }

    this.notificationService
      .create({
        userId: order.userId,
        type: 'PAYMENT',
        title: isSubscription
          ? subscriptionTitle
          : `Thanh toán đơn hàng #${order.orderCode} thành công`,
        message: isSubscription
          ? subscriptionMessage
          : 'Chúng tôi đã nhận được thanh toán của bạn và đang xử lý đơn hàng.',
        data: {
          orderId: order.id,
          orderCode: order.orderCode,
          status: OrderStatus.PAID,
          ...(isSubscription ? { targetTier: order.targetTier, subscriptionMode } : {}),
        },
      })
      .catch(() => undefined);

    if (isSubscription) {
      return { message: 'Payment processed and user tier updated successfully' };
    }

    // Enqueue outbox event để worker tạo shipment (không gọi provider trong transaction).
    // Fire-and-forget để không block response - lỗi đã được log trong catch.
    this.outboxService
      .enqueueEvent({
        type: OUTBOX_EVENT_TYPE.SHIPMENT_CREATE_REQUESTED,
        aggregateType: 'Order',
        aggregateId: order.id,
        payload: { orderId: order.id, orderCode: order.orderCode, userId: order.userId },
      })
      .then((event) =>
        this.logger.log(
          `Enqueued SHIPMENT_CREATE_REQUESTED | eventKey=${event.eventKey} | orderId=${order.id} | orderCode=${order.orderCode}`,
        ),
      )
      .catch((err) =>
        this.logger.error(`Failed to enqueue SHIPMENT_CREATE_REQUESTED for order ${orderCode}: ${err?.message}`),
      );

    // Gửi email xác nhận đơn hàng cho user. Fire-and-forget để không block response.
    this.sendOrderConfirmationEmail(order.id).catch((err) =>
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

    await this.mailQueueService.sendOrderConfirmationEmail(order.user.email, {
      orderId: order.id,
      orderCode: order.orderCode,
      items: order.items.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
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

  async sendRenewalReminders() {
    const subs = await this.subscriptionService.findSubscriptionsDueForRenewal(
      RENEWAL_REMINDER_DAYS_BEFORE,
    );

    let remindersSent = 0;
    let ordersCreated = 0;

    for (const sub of subs) {
      try {
        // Create renewal order
        const renewalOrder = await createWithUniqueOrderCode((orderCode) =>
          this.prisma.order.create({
            data: {
              orderCode,
              userId: sub.userId,
              targetTier: sub.tier,
              amount: TIER_PRICES[sub.tier],
              status: OrderStatus.PENDING,
              paymentStatus: PaymentStatus.PENDING,
            },
          }),
        );

        // Generate checkout link
        const { checkoutUrl } = await this.createSePayCheckoutLink(renewalOrder);

        await this.prisma.order.update({
          where: { id: renewalOrder.id },
          data: {
            paymentProvider: 'SEPAY',
            checkoutUrl,
            checkoutExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });

        ordersCreated++;

        // Send notification
        this.notificationService
          .create({
            userId: sub.userId,
            type: 'PAYMENT',
            title: `Gói ${sub.tier} sắp hết hạn`,
            message: `Gói ${sub.tier} của bạn hết hạn vào ${sub.expiresAt.toLocaleDateString('vi-VN')}. Thanh toán ${TIER_PRICES[sub.tier].toLocaleString('vi-VN')}đ để tiếp tục sử dụng.`,
            data: {
              subscriptionId: sub.id,
              orderId: renewalOrder.id,
              orderCode: renewalOrder.orderCode,
              checkoutUrl,
              tier: sub.tier,
              expiresAt: sub.expiresAt,
              daysRemaining: Math.ceil(
                (sub.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
              ),
            },
          })
          .catch(() => undefined);

        // Send email
        await this.mailQueueService
          .sendRenewalReminderEmail(sub.user.email, {
            name: sub.user.name || 'Khách hàng',
            tier: sub.tier,
            tierLabel: sub.tier,
            price: TIER_PRICES[sub.tier],
            expiresAt: sub.expiresAt,
            daysRemaining: Math.ceil(
              (sub.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
            ),
            checkoutUrl,
            orderCode: renewalOrder.orderCode,
          })
          .catch((err) => {
            this.logger.warn(`Failed to send renewal reminder email for user ${sub.userId}: ${err.message}`);
          });

        // Mark reminder sent
        await this.subscriptionService.markRenewalReminderSent(sub.id);
        remindersSent++;
      } catch (err) {
        this.logger.error(
          `Error processing renewal reminder for subscription ${sub.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `Renewal reminders sent: ${remindersSent}/${subs.length}, orders created: ${ordersCreated}`,
    );

    return { remindersSent, ordersCreated, totalProcessed: subs.length };
  }
}
