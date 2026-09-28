import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, OrderStatus, PaymentStatus, Prisma, Product, RefundStatus, Role, ShipmentStatus } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { MailQueueService } from '../mail/mail-queue.service';
import { NotificationService } from '../notification/notification.service';
import { createWithUniqueOrderCode } from '../../common/utils/order-code.util';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  MAX_INT4,
  MEASUREMENT_SNAPSHOT_FIELDS,
  ONLINE_PAYMENT_METHODS,
  ORDER_STATUS_MESSAGE,
  ORDER_STATUS_TRANSITIONS,
  STATUS_NOTIFY_EMAIL,
  UUID_REGEX,
} from './constants/order-flow.constants';
import { CreateMeasurementReviewDto, UpdateItemMeasurementDto } from './dto/measurement-review.dto';
import { RefundOrderDto } from './dto/refund-order.dto';
import { CancelShipmentDto, CreateShipmentDto } from './dto/shipment.dto';
import { ShippingProviderType } from '../shipping/constants/shipping-provider.enum';
import { ShippingService } from '../shipping/shipping.service';
import { UserAddressesService } from '../users/user-addresses.service';
import {
  MEASUREMENT_LABELS,
  MeasurementField,
  getMissingMeasurements,
} from '../../common/constants/measurement.constants';

type IOrderWithRelations = Prisma.OrderGetPayload<{
  include: ReturnType<OrdersService['orderInclude']>;
}> & { user?: unknown };

type IOrderProduct = Product;
type ResolvedCreateOrderDto = CreateOrderDto & { shippingInfo: NonNullable<CreateOrderDto['shippingInfo']> };
type QuotePayload = {
  userId: string;
  fingerprint: string;
  shippingAddressId?: string;
  addressVersion?: number;
  pricing: {
    itemsTotal: number;
    shippingFee: number;
    discountAmount: number;
    total: number;
    couponCode?: string;
  };
  expiresAt: string;
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailQueueService: MailQueueService,
    private readonly notificationService: NotificationService,
    private readonly shippingService: ShippingService,
    private readonly userAddressesService: UserAddressesService,
  ) {}

  async quote(userId: string, dto: CreateOrderDto) {
    const resolvedDto = await this.resolveOrderAddress(userId, dto);
    const products = await this.getActiveOrderProducts(dto);
    const pricing = await this.buildOrderPricing(resolvedDto, products);
    const fingerprint = this.buildOrderFingerprint(userId, resolvedDto);
    const quoteToken = this.signQuote({
      userId,
      fingerprint,
      shippingAddressId: resolvedDto.shippingAddressId,
      addressVersion: resolvedDto.addressVersion,
      pricing: {
        itemsTotal: pricing.itemsTotal,
        shippingFee: pricing.shippingFee,
        discountAmount: pricing.discountAmount,
        total: pricing.total,
        couponCode: pricing.couponCode,
      },
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    return {
      userId,
      itemsTotal: pricing.itemsTotal,
      shippingFee: pricing.shippingFee,
      discountAmount: pricing.discountAmount,
      couponCode: pricing.couponCode,
      totalAmount: pricing.total,
      shippingQuote: pricing.shippingQuote,
      quoteToken,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
  }

  async create(userId: string, dto: CreateOrderDto) {
    const paymentMethod = dto.paymentMethod ?? 'BANK_TRANSFER';
    if (!ONLINE_PAYMENT_METHODS.includes(paymentMethod as (typeof ONLINE_PAYMENT_METHODS)[number])) {
      throw new BadRequestException('Đơn may đo mới chỉ hỗ trợ thanh toán online, không hỗ trợ COD.');
    }

    const resolvedDto = await this.resolveOrderAddress(userId, dto);
    const requestFingerprint = this.buildOrderFingerprint(userId, resolvedDto);
    if (dto.idempotencyKey) {
      const existing = await this.prisma.orderIdempotencyKey.findUnique({
        where: { userId_key: { userId, key: dto.idempotencyKey } },
      });
      if (existing?.orderId) return this.findOne(userId, existing.orderId);
      if (existing && existing.fingerprint !== requestFingerprint) {
        throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key đã được dùng cho payload khác.' });
      }
    }

    const productIds = resolvedDto.items.map((item) => item.productId);
    const products = await this.getActiveOrderProducts(resolvedDto);

    const productMap = new Map(products.map((product) => [product.id, product]));
    const missingIds = productIds.filter((id) => !productMap.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestException(
        `Sản phẩm không tồn tại hoặc chưa active: ${missingIds.join(', ')}`,
      );
    }

    // Đặt may theo số đo: user phải điền đủ số đo cơ thể bắt buộc dựa trên loại
    // trang phục cụ thể (garmentType) trong đơn. Chụp lại (snapshot) số đo lên
    // từng OrderItem để đóng băng tại thời điểm đặt.
    const measurement = await this.prisma.measurement.findUnique({
      where: { userId },
    });
    const missingFields = getMissingMeasurements(
      measurement as Partial<Record<MeasurementField, unknown>> | null,
      products.map((p) => ({ category: p.category, garmentType: p.garmentType })),
    );
    if (missingFields.length > 0) {
      throw new BadRequestException({
        code: 'MEASUREMENTS_INCOMPLETE',
        message:
          'Vui lòng cập nhật đầy đủ số đo cơ thể trong hồ sơ trước khi đặt may.',
        missingFields,
        missing: missingFields.map((field) => ({
          field,
          label: MEASUREMENT_LABELS[field],
        })),
      });
    }

    const measurementSnapshot = this.buildMeasurementSnapshot(measurement);

    // Luôn dùng giá trong DB, KHÔNG tin item.price do client gửi lên, tránh gian
    // lận giá (client không thể tự đặt giá sản phẩm).
    const { itemsTotal, shippingFee, discountAmount, total, couponCode, shippingQuote } =
      await this.buildOrderPricing(resolvedDto, products);

    if (dto.quoteToken) {
      this.assertQuoteToken(dto.quoteToken, userId, requestFingerprint, total);
    }

    // Chặn việc dùng giảm giá để đưa đơn về 0 đồng.
    if (discountAmount > itemsTotal + shippingFee) {
      throw new BadRequestException('Số tiền giảm giá vượt quá giá trị đơn hàng');
    }

    if (total <= 0) {
      throw new BadRequestException('Giá trị đơn hàng phải lớn hơn 0');
    }

    // totalAmount giờ là double-check thực sự: FE phải khớp tổng BE tính từ giá server.
    if (resolvedDto.totalAmount !== undefined && resolvedDto.totalAmount !== total) {
      throw new BadRequestException(`Tổng tiền không khớp: FE gửi ${resolvedDto.totalAmount}, BE tính ${total}`);
    }

    // Prepare shipping info with note/notes compatibility
    const shippingInfo = {
      ...resolvedDto.shippingInfo,
      note: resolvedDto.shippingInfo.note ?? resolvedDto.shippingInfo.notes ?? '',
    };

    const order = await createWithUniqueOrderCode((orderCode) =>
      this.prisma.$transaction(async (tx) => {
        if (resolvedDto.shippingAddressId) {
          const addressAtCommit = await tx.userAddress.findFirst({
            where: { id: resolvedDto.shippingAddressId, userId, version: resolvedDto.addressVersion },
          });
          if (!addressAtCommit) {
            throw new ConflictException({ code: 'ADDRESS_VERSION_CONFLICT', message: 'Địa chỉ đã được sửa hoặc xóa. Vui lòng kiểm tra lại trước khi đặt hàng.' });
          }
        }

        const created = await tx.order.create({
          data: {
            orderCode,
            userId,
            amount: new Prisma.Decimal(total),
            itemsSubtotalVnd: this.toVnd(itemsTotal),
            shippingFeeVnd: this.toVnd(shippingFee),
            discountVnd: this.toVnd(discountAmount),
            taxVnd: 0,
            totalVnd: this.toVnd(total),
            currency: 'VND',
            status: OrderStatus.PENDING,
            paymentStatus: PaymentStatus.PENDING,
            refundStatus: RefundStatus.NONE,
            fulfillmentFlowVersion: 1,
            shippingInfo: shippingInfo as unknown as Prisma.InputJsonValue,
            shippingAddressSnapshot: shippingInfo as unknown as Prisma.InputJsonValue,
            shippingQuoteSnapshot: shippingQuote as unknown as Prisma.InputJsonValue,
            paymentMethod,
            shippingFee: new Prisma.Decimal(shippingFee),
            discountAmount: new Prisma.Decimal(discountAmount),
            couponCode,
            items: {
              create: resolvedDto.items.map((item) => {
                const product = productMap.get(item.productId)!;
                return {
                  productId: item.productId,
                  quantity: item.quantity,
                  color: item.color,
                  measurementSnapshot:
                    measurementSnapshot as Prisma.InputJsonValue,
                  productNameSnapshot: product.name,
                  productCategorySnapshot: product.category,
                  brandSnapshot: product.brand,
                  fabricSnapshot: product.material,
                  // Chốt giá server tại thời điểm đặt hàng: đổi giá sản phẩm sau này
                  // không ảnh hưởng đơn cũ, và client không thể tự đặt giá.
                  price: product.price,
                  unitPriceVnd: this.toVnd(Number(product.price)),
                  lineTotalVnd: this.toVnd(Number(product.price) * item.quantity),
                };
              }),
            },
            payments: {
              create: {
                method: paymentMethod,
                provider: 'SEPAY',
                status: PaymentStatus.PENDING,
                amountVnd: this.toVnd(total),
                currency: 'VND',
                idempotencyKey: `payment:create:${orderCode}`,
              },
            },
          },
          include: this.orderInclude(),
        });

        await this.createOrderEvent(tx, {
          orderId: created.id,
          type: 'ORDER_CREATED',
          source: 'USER',
          actorId: userId,
          toStatus: OrderStatus.PENDING,
          publicMessage: 'Đơn hàng đã được tạo và đang chờ thanh toán.',
          deduplicationKey: `order:${created.id}:created`,
        });

        if (dto.idempotencyKey) {
          await tx.orderIdempotencyKey.upsert({
            where: { userId_key: { userId, key: dto.idempotencyKey } },
            create: { userId, key: dto.idempotencyKey, fingerprint: requestFingerprint, orderId: created.id },
            update: { orderId: created.id },
          });
        }

        return created;
      }),
    );

    // Notify admins about new order (fire-and-forget, don't block response)
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const customerName = user?.name ?? 'Khách hàng';
    this.notifyAdminsNewOrder(
      { id: order.id, orderCode: order.orderCode, totalVnd: order.totalVnd },
      customerName,
    ).catch(() => undefined);

    return this.toPublicOrder(order);
  }

  async findAll(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: this.orderInclude(),
    });
    return orders.map((order) => this.toPublicOrder(order));
  }

  async findOne(userId: string, id: string) {
    const where = this.resolveOrderWhere(id);
    if (!where) {
      throw new NotFoundException(`Không tìm thấy đơn hàng có ID ${id}`);
    }

    const order = await this.prisma.order.findFirst({
      where: { ...where, userId },
      include: this.orderInclude(),
    });

    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng có ID ${id}`);
    }

    return this.toPublicOrder(order);
  }

  async cancel(userId: string, id: string) {
    const order = await this.findOrderForOwner(userId, id);
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Chỉ có thể hủy đơn hàng đang chờ xử lý');
    }

    // updateMany + điều kiện status để hai request hủy đồng thời (hoặc hủy đúng
    // lúc webhook ghi PAID) không cùng thắng. Dùng order.id (UUID đã phân giải)
    // thay vì param thô để tránh lỗi cast khi client gửi orderCode.
    const { count } = await this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: order.id, userId, status: OrderStatus.PENDING, OR: [{ paymentStatus: PaymentStatus.PENDING }, { paymentStatus: null }] },
        data: {
          status: OrderStatus.CANCELLED,
          checkoutUrl: null,
          checkoutExpiresAt: null,
        },
      });
      if (result.count > 0) {
        await this.createOrderEvent(tx, {
          orderId: order.id,
          type: 'ORDER_CANCELLED',
          source: 'USER',
          actorId: userId,
          fromStatus: OrderStatus.PENDING,
          toStatus: OrderStatus.CANCELLED,
          publicMessage: 'Khách hàng đã hủy đơn trước khi thanh toán.',
          deduplicationKey: `order:${order.id}:cancel:user`,
        });
      }
      return result;
    });

    if (count === 0) {
      throw new BadRequestException(
        'Đơn hàng vừa được cập nhật trạng thái, không thể hủy. Vui lòng tải lại.',
      );
    }

    // Notify admins about cancelled order (fire-and-forget, don't block response)
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const customerName = user?.name ?? 'Khách hàng';
    this.notifyAdminOrderCancelled(
      { id: order.id, orderCode: order.orderCode, totalVnd: order.totalVnd },
      customerName,
    ).catch(() => undefined);

    return this.findOne(userId, order.id);
  }

  async findAllAdmin(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          ...this.orderInclude(),
          user: {
            select: { id: true, name: true, email: true, tier: true },
          },
        },
      }),
      this.prisma.order.count(),
    ]);

    return {
      items: items.map((order) => this.toPublicOrder(order)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async updateStatus(id: string, dtoOrStatus: OrderStatus | { status: OrderStatus; expectedStatus?: OrderStatus; publicMessage?: string; internalNote?: string }, actorId?: string) {
    const dto = typeof dtoOrStatus === 'string' ? { status: dtoOrStatus } : dtoOrStatus;
    const status = dto.status;
    const where = this.resolveOrderWhere(id);
    const order = where
      ? await this.prisma.order.findFirst({
          where,
          include: { user: { select: { email: true } } },
        })
      : null;
    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng có ID ${id}`);
    }

    if (order.status === status) {
      const unchanged = await this.prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: this.orderInclude(),
      });
      return this.toPublicOrder(unchanged);
    }

    if (dto.expectedStatus && dto.expectedStatus !== order.status) {
      throw new ConflictException('Đơn hàng đã được cập nhật bởi thao tác khác. Vui lòng tải lại.');
    }

    const isNewFlow = order.fulfillmentFlowVersion === 1;
    const allowed = isNewFlow
      ? ORDER_STATUS_TRANSITIONS[order.status].filter((next) => next !== OrderStatus.CONFIRMED)
      : ORDER_STATUS_TRANSITIONS[order.status];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Không thể chuyển đơn hàng từ ${order.status} sang ${status}.` +
          (allowed.length > 0
            ? ` Trạng thái hợp lệ: ${allowed.join(', ')}.`
            : ' Đây là trạng thái kết thúc.'),
      );
    }

    const verifiedOnlyStatuses: OrderStatus[] = [OrderStatus.SHIPPING, OrderStatus.DELIVERED, OrderStatus.PAID];
    if (isNewFlow && verifiedOnlyStatuses.includes(status)) {
      throw new BadRequestException('Trạng thái này phải do thanh toán hoặc vận chuyển đã xác minh cập nhật.');
    }

    if (isNewFlow && status === OrderStatus.MEASUREMENT_CONFIRMED) {
      await this.assertNoOpenMeasurementReviews(order.id);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status, ...(status === OrderStatus.CANCELLED && order.paymentStatus === PaymentStatus.PAID ? { refundStatus: RefundStatus.REQUIRED } : {}) },
      });
      await this.createOrderEvent(tx, { orderId: order.id, type: 'STATUS_CHANGED', source: 'ADMIN', actorId, fromStatus: order.status, toStatus: status, publicMessage: dto.publicMessage ?? ORDER_STATUS_MESSAGE[status], internalNote: dto.internalNote });
    });

    // Gửi email thông báo cho user; lỗi email không được làm hỏng luồng cập nhật.
    if (STATUS_NOTIFY_EMAIL.includes(status) && order.user?.email) {
      this.mailQueueService
        .sendOrderStatusUpdateEmail(order.user.email, {
          orderId: order.id,
          orderCode: order.orderCode,
          status,
          shippingInfo: order.shippingInfo as {
            name?: string;
            phone?: string;
            address?: string;
          } | null,
        })
        .catch(() => undefined);
    }

    // Notification realtime; lỗi realtime không được làm fail luồng nghiệp vụ.
    this.notificationService
      .create({
        userId: order.userId,
        type: 'ORDER_STATUS',
        title: `Cập nhật đơn hàng #${order.orderCode}`,
        message: ORDER_STATUS_MESSAGE[status] ?? `Trạng thái đơn hàng: ${status}`,
        data: { orderId: order.id, orderCode: order.orderCode, status },
      })
      .catch(() => undefined);

    const updated = await this.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: this.orderInclude(),
    });
    return this.toPublicOrder(updated);
  }

  async requestMeasurementReview(orderId: string, itemId: string, dto: CreateMeasurementReviewDto, actorId: string) {
    const order = await this.findOrderByIdentifier(orderId);
    const item = order
      ? await this.prisma.orderItem.findFirst({ where: { id: itemId, orderId: order.id } })
      : null;
    if (!order || !item) throw new NotFoundException('Không tìm thấy item thuộc đơn hàng');
    if (order.fulfillmentFlowVersion !== 1 || order.status !== OrderStatus.MEASUREMENT_REVIEW) {
      throw new BadRequestException('Chỉ mở yêu cầu số đo khi đơn đang ở bước kiểm tra số đo.');
    }

    const review = { status: 'OPEN', message: dto.message, openedAt: new Date().toISOString() };
    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.update({ where: { id: item.id }, data: { measurementReview: review as Prisma.InputJsonValue } });
      await this.createOrderEvent(tx, { orderId: order.id, type: 'MEASUREMENT_REVIEW_OPENED', source: 'ADMIN', actorId, publicMessage: dto.message, internalNote: dto.internalNote });
    });

    return this.findOne(order.userId, order.id);
  }

  async updateItemMeasurement(userId: string, orderId: string, itemId: string, dto: UpdateItemMeasurementDto) {
    const order = await this.findOrderForOwner(userId, orderId);
    const item = await this.prisma.orderItem.findFirst({ where: { id: itemId, orderId: order.id } });
    if (!item) throw new NotFoundException('Không tìm thấy item thuộc đơn hàng');
    const review = item.measurementReview as { status?: string; message?: string } | null;
    if (order.status !== OrderStatus.MEASUREMENT_REVIEW || review?.status !== 'OPEN') {
      throw new BadRequestException('Item này không có yêu cầu chỉnh số đo đang mở.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          measurementSnapshot: dto.measurementSnapshot as Prisma.InputJsonValue,
          measurementReview: { ...review, status: 'SUBMITTED', submittedAt: new Date().toISOString() } as Prisma.InputJsonValue,
        },
      });
      await this.createOrderEvent(tx, { orderId: order.id, type: 'MEASUREMENT_RESUBMITTED', source: 'USER', actorId: userId, publicMessage: 'Khách hàng đã gửi lại số đo cho item.' });
    });

    return this.findOne(userId, order.id);
  }

  async updateRefund(id: string, dto: RefundOrderDto, actorId: string) {
    const order = await this.findOrderByIdentifier(id);
    if (!order) throw new NotFoundException(`Không tìm thấy đơn hàng có ID ${id}`);

    const hasMomoPayment = order.payments?.some((payment) => payment.provider === 'MOMO');
    if (hasMomoPayment && dto.refundStatus === RefundStatus.COMPLETED) {
      throw new BadRequestException('Không được xác nhận hoàn tiền MoMo thủ công. Vui lòng dùng endpoint hoàn tiền MoMo trong Payments.');
    }

    const paymentStatus = dto.refundStatus === RefundStatus.COMPLETED ? PaymentStatus.REFUNDED : order.paymentStatus;
    const refundStatusForOrder = dto.refundStatus === RefundStatus.COMPLETED
      ? RefundStatus.COMPLETED
      : dto.refundStatus === RefundStatus.PROCESSING
        ? RefundStatus.PENDING
        : dto.refundStatus;

    await this.prisma.$transaction(async (tx) => {
      // Create Refund record for tracking
      if (dto.refundStatus === RefundStatus.REQUIRED || dto.refundStatus === RefundStatus.PROCESSING || dto.refundStatus === RefundStatus.COMPLETED) {
        const existingRefund = await tx.refund.findFirst({
          where: { orderId: order.id, status: { notIn: ['CANCELLED'] } },
        });

        if (!existingRefund) {
          await tx.refund.create({
            data: {
              orderId: order.id,
              provider: 'MANUAL',
              amountVnd: BigInt(Math.round(Number(order.amount))),
              reason: dto.internalNote ?? 'Refund requested',
              status: refundStatusForOrder,
              idempotencyKey: `refund:${order.id}:${Date.now()}`,
            },
          });
        } else if (dto.refundStatus === RefundStatus.COMPLETED) {
          await tx.refund.update({
            where: { id: existingRefund.id },
            data: { status: RefundStatus.COMPLETED, processedAt: new Date() },
          });
          // Update amountRefundedVnd on order
          await tx.order.update({
            where: { id: order.id },
            data: { amountRefundedVnd: BigInt(Math.round(Number(order.amount))) },
          });
        }
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          refundStatus: dto.refundStatus,
          refundEvidence: dto.evidence as Prisma.InputJsonValue | undefined,
          paymentStatus,
        },
      });
      await this.createOrderEvent(tx, { orderId: order.id, type: 'REFUND_UPDATED', source: 'ADMIN', actorId, publicMessage: dto.refundStatus === RefundStatus.COMPLETED ? 'Khoản hoàn tiền đã được ghi nhận.' : 'Trạng thái hoàn tiền đã được cập nhật.', internalNote: dto.internalNote });
    });

    return this.findOne(order.userId, order.id);
  }

  async createShipment(id: string, dto: CreateShipmentDto, actorId: string) {
    const order = await this.findOrderByIdentifier(id);
    if (!order) throw new NotFoundException(`Không tìm thấy đơn hàng có ID ${id}`);
    if (order.fulfillmentFlowVersion !== 1 || order.status !== OrderStatus.READY_TO_SHIP || order.paymentStatus !== PaymentStatus.PAID) {
      throw new BadRequestException('Chỉ tạo vận đơn cho đơn may đo READY_TO_SHIP đã thanh toán.');
    }

    const requestKey = dto.requestKey ?? `order:${order.id}:shipment:${order.updatedAt.getTime()}`;
    const existingShipment = await this.prisma.shipment.findFirst({
      where: { orderId: order.id, status: { notIn: [ShipmentStatus.DELIVERED, ShipmentStatus.RETURNED, ShipmentStatus.CANCELLED] } },
    });
    if (existingShipment?.providerOrderCode) {
      return { shipment: existingShipment, order: await this.findOne(order.userId, order.id) };
    }

    const pendingShipment = existingShipment ?? await this.prisma.shipment.create({
      data: {
        orderId: order.id,
        provider: ShippingProviderType.GHN,
        requestKey,
        status: ShipmentStatus.PENDING,
        shippingFee: order.shippingFee,
        quotedShippingFee: order.shippingFee,
        lastSyncedAt: new Date(),
      },
    });

    const result = await this.shippingService.createShipment(this.buildShipmentInput(order), requestKey);

    const shipment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shipment.update({
        where: { id: pendingShipment.id },
        data: {
          status: result.status,
          providerOrderCode: result.providerOrderCode,
          shippingFee: new Prisma.Decimal(result.shippingFee),
          shippingFeeVnd: BigInt(Math.round(result.shippingFee)),
          actualShippingFee: new Prisma.Decimal(result.shippingFee),
          expectedDeliveryTime: result.expectedDeliveryTime,
          trackingData: result.raw as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
        },
      });
      await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.SHIPPING } });
      await this.createOrderEvent(tx, { orderId: order.id, shipmentId: created.id, type: 'SHIPMENT_CREATED', source: 'ADMIN', actorId, fromStatus: OrderStatus.READY_TO_SHIP, toStatus: OrderStatus.SHIPPING, fromShipmentStatus: pendingShipment.status, toShipmentStatus: result.status, publicMessage: 'Vận đơn đã được tạo và đang chờ đơn vị vận chuyển xử lý.', deduplicationKey: `shipment:${requestKey}:created` });
      return created;
    });

    return { shipment, order: await this.findOne(order.userId, order.id) };
  }

  async cancelShipment(id: string, dto: CancelShipmentDto, actorId: string) {
    const order = await this.findOrderByIdentifier(id);
    if (!order) throw new NotFoundException(`Không tìm thấy đơn hàng có ID ${id}`);
    const shipment = await this.prisma.shipment.findFirst({
      where: { orderId: order.id, status: { notIn: [ShipmentStatus.DELIVERED, ShipmentStatus.RETURNED, ShipmentStatus.CANCELLED] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!shipment) throw new NotFoundException('Không có vận đơn active để hủy');

    if (shipment.providerOrderCode) {
      await this.shippingService.cancelShipment(shipment.provider as ShippingProviderType, shipment.providerOrderCode);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.shipment.update({ where: { id: shipment.id }, data: { status: ShipmentStatus.CANCELLED, lastSyncedAt: new Date() } });
      await this.createOrderEvent(tx, { orderId: order.id, shipmentId: shipment.id, type: 'SHIPMENT_CANCELLED', source: 'ADMIN', actorId, publicMessage: 'Vận đơn đã được hủy.', internalNote: dto.reason });
    });

    return this.findOne(order.userId, order.id);
  }

  async confirmDelivery(userId: string, id: string, note?: string) {
    const order = await this.findOrderForOwner(userId, id);
    if (order.status !== OrderStatus.SHIPPING && order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException('Chỉ có thể xác nhận khi đơn hàng đang giao hoặc đã được giao (status = SHIPPING hoặc DELIVERED).');
    }

    const fromStatus = order.status;
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.COMPLETED, updatedAt: new Date() },
      });
      await this.createOrderEvent(tx, {
        orderId: order.id,
        type: 'DELIVERY_CONFIRMED',
        source: 'USER',
        actorId: userId,
        fromStatus,
        toStatus: OrderStatus.COMPLETED,
        publicMessage: 'Khách hàng đã xác nhận nhận hàng thành công.',
        internalNote: note,
      });
    });

    this.notificationService
      .create({
        userId: order.userId,
        type: 'ORDER_STATUS',
        title: `Đơn hàng #${order.orderCode} đã hoàn thành`,
        message: 'Cảm ơn bạn đã xác nhận nhận hàng. Đơn hàng của bạn đã hoàn thành.',
        data: { orderId: order.id, orderCode: order.orderCode, status: OrderStatus.COMPLETED },
      })
      .catch(() => undefined);

    return this.findOne(userId, order.id);
  }

  async getTracking(userId: string, id: string) {
    const order = await this.findOrderForOwner(userId, id);
    const shipment = order.shipments?.[0];
    if (!shipment?.providerOrderCode) {
      return order.shipments?.[0] ?? null;
    }

    const tracking = await this.shippingService.getTracking(
      shipment.provider as ShippingProviderType,
      shipment.providerOrderCode,
    );
    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        status: tracking.status,
        expectedDeliveryTime: tracking.expectedDeliveryTime,
        trackingData: tracking.raw as Prisma.InputJsonValue,
        lastSyncedAt: new Date(),
      },
    });
    return {
      provider: tracking.provider,
      trackingCode: tracking.trackingCode,
      status: tracking.status,
      expectedDeliveryTime: tracking.expectedDeliveryTime,
    };
  }

  private async resolveOrderAddress(userId: string, dto: CreateOrderDto): Promise<ResolvedCreateOrderDto> {
    if (dto.shippingAddressId && dto.shippingInfo) {
      throw new BadRequestException({ code: 'ADDRESS_INVALID', message: 'Chỉ gửi một trong hai: shippingAddressId hoặc shippingInfo.' });
    }

    if (dto.shippingAddressId) {
      const address = await this.userAddressesService.findOwned(userId, dto.shippingAddressId);
      if (dto.addressVersion !== undefined && address.version !== dto.addressVersion) {
        throw new ConflictException({ code: 'ADDRESS_VERSION_CONFLICT', message: 'Địa chỉ đã thay đổi. Vui lòng kiểm tra lại trước khi đặt hàng.' });
      }
      return {
        ...dto,
        addressVersion: address.version,
        shippingInfo: this.userAddressesService.toShippingInfo(address, dto.shippingNote),
      };
    }

    if (!dto.shippingInfo) {
      throw new BadRequestException({ code: 'ADDRESS_REQUIRED', message: 'Vui lòng chọn địa chỉ giao hàng.' });
    }

    const normalizedLocation = await this.shippingService.validateGhnLocation(
      dto.shippingInfo.ghnProvinceId ?? 0,
      dto.shippingInfo.ghnDistrictId ?? 0,
      dto.shippingInfo.ghnWardCode ?? '',
    );
    return {
      ...dto,
      shippingInfo: {
        ...dto.shippingInfo,
        ...normalizedLocation,
        note: dto.shippingInfo.note ?? dto.shippingInfo.notes ?? dto.shippingNote ?? '',
        notes: dto.shippingInfo.notes ?? dto.shippingInfo.note ?? dto.shippingNote ?? '',
      },
    };
  }

  private buildOrderFingerprint(userId: string, dto: ResolvedCreateOrderDto) {
    const payload = {
      userId,
      items: dto.items.map((item) => ({ productId: item.productId, quantity: item.quantity, color: item.color ?? null })).sort((a, b) => `${a.productId}:${a.color ?? ''}`.localeCompare(`${b.productId}:${b.color ?? ''}`)),
      couponCode: dto.couponCode?.trim().toUpperCase() ?? null,
      shippingAddressId: dto.shippingAddressId ?? null,
      addressVersion: dto.addressVersion ?? null,
      shippingInfo: dto.shippingAddressId ? null : {
        ghnProvinceId: dto.shippingInfo.ghnProvinceId,
        ghnDistrictId: dto.shippingInfo.ghnDistrictId,
        ghnWardCode: dto.shippingInfo.ghnWardCode,
        address: dto.shippingInfo.address,
        phone: dto.shippingInfo.phone,
      },
      shippingNote: dto.shippingNote ?? dto.shippingInfo.note ?? dto.shippingInfo.notes ?? '',
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private signQuote(payload: QuotePayload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.quoteSecret()).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  private assertQuoteToken(token: string, userId: string, fingerprint: string, total: number) {
    const [body, signature] = token.split('.');
    if (!body || !signature) throw new BadRequestException({ code: 'QUOTE_EXPIRED', message: 'Báo giá không hợp lệ hoặc đã hết hạn.' });
    const expected = createHmac('sha256', this.quoteSecret()).update(body).digest('base64url');
    if (!this.safeEqual(signature, expected)) throw new BadRequestException({ code: 'QUOTE_EXPIRED', message: 'Báo giá không hợp lệ hoặc đã hết hạn.' });
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as QuotePayload;
    if (payload.userId !== userId || payload.fingerprint !== fingerprint) {
      throw new ConflictException({ code: 'QUOTE_CHANGED', message: 'Thông tin đơn hàng hoặc địa chỉ đã thay đổi. Vui lòng xác nhận lại báo giá.' });
    }
    if (new Date(payload.expiresAt).getTime() < Date.now()) {
      throw new BadRequestException({ code: 'QUOTE_EXPIRED', message: 'Báo giá đã hết hạn. Vui lòng thử lại.' });
    }
    if (payload.pricing.total !== total) {
      throw new ConflictException({ code: 'QUOTE_CHANGED', message: 'Tổng tiền đã thay đổi. Vui lòng xác nhận lại trước khi đặt hàng.' });
    }
  }

  private safeEqual(a: string, b: string) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private quoteSecret() {
    return process.env.ORDER_QUOTE_SECRET || process.env.JWT_SECRET || 'fashionai-order-quote-dev-secret';
  }

  private async getActiveOrderProducts(dto: CreateOrderDto) {
    const productIds = dto.items.map((item) => item.productId);
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        status: 'ACTIVE',
      },
    });

    const productMap = new Map(products.map((product) => [product.id, product]));
    const missingIds = productIds.filter((id) => !productMap.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestException(
        `Product is missing or inactive: ${missingIds.join(', ')}`,
      );
    }

    return products;
  }

  private async buildOrderPricing(dto: ResolvedCreateOrderDto, products: IOrderProduct[]) {
    const productMap = new Map(products.map((product) => [product.id, product]));
    const itemsTotal = dto.items.reduce((sum, item) => {
      const product = productMap.get(item.productId)!;
      return sum + Number(product.price) * item.quantity;
    }, 0);
    const shippingQuote = await this.calculateOrderShippingFee(dto, itemsTotal);
    const shippingFee = shippingQuote.totalFee;
    const discountAmount = this.resolveDiscountAmount(dto.couponCode, itemsTotal);

    if (discountAmount > itemsTotal + shippingFee) {
      throw new BadRequestException('Discount amount exceeds order amount');
    }

    const total = itemsTotal + shippingFee - discountAmount;
    if (total <= 0) {
      throw new BadRequestException('Order total must be greater than 0');
    }

    return {
      itemsTotal,
      shippingFee,
      discountAmount,
      couponCode: discountAmount > 0 ? dto.couponCode?.trim().toUpperCase() : undefined,
      total,
      shippingQuote: {
        provider: shippingQuote.provider,
        totalFee: shippingQuote.totalFee,
        serviceFee: shippingQuote.serviceFee,
        insuranceFee: shippingQuote.insuranceFee,
        codFee: shippingQuote.codFee,
        expectedDeliveryTime: shippingQuote.expectedDeliveryTime,
      },
    };
  }

  private calculateOrderShippingFee(dto: ResolvedCreateOrderDto, itemsTotal: number) {
    const { ghnDistrictId, ghnWardCode } = dto.shippingInfo;
    if (!ghnDistrictId || !ghnWardCode) {
      throw new BadRequestException('GHN district and ward are required to calculate shipping fee');
    }

    const weight = Math.max(
      500,
      dto.items.reduce((sum, item) => sum + item.quantity * 500, 0),
    );

    return this.shippingService.calculateFee({
      toDistrictId: ghnDistrictId,
      toWardCode: ghnWardCode,
      weight,
      length: 25,
      width: 20,
      height: 8,
      insuranceValue: itemsTotal,
      codAmount: 0,
    });
  }

  private resolveDiscountAmount(couponCode: string | undefined, itemsTotal: number) {
    const code = couponCode?.trim().toUpperCase();
    if (!code) return 0;

    switch (code) {
      case 'WELCOME':
        return Math.min(100000, itemsTotal);
      case 'STALE10':
        return Math.round(itemsTotal * 0.1);
      case 'FASHIONAI':
        return Math.min(150000, itemsTotal);
      default:
        throw new BadRequestException('Coupon code is invalid or expired');
    }
  }

  private toVnd(amount: number) {
    return BigInt(Math.round(amount));
  }

  // Chụp lại số đo cơ thể thành object number thuần để lưu JSON trên OrderItem.
  // Chỉ giữ các trường có giá trị; Decimal được chuyển về number.
  private buildMeasurementSnapshot(
    measurement: Partial<Record<MeasurementField, unknown>> | null,
  ): Record<string, number> {
    const snapshot: Record<string, number> = {};
    if (!measurement) return snapshot;
    for (const field of MEASUREMENT_SNAPSHOT_FIELDS) {
      const value = measurement[field];
      if (value !== null && value !== undefined) {
        snapshot[field] = Number(value);
      }
    }
    return snapshot;
  }

  private orderInclude() {
    return {
      items: {
        include: {
          product: {
            include: { images: true },
          },
        },
      },
      payments: true,
      shipments: { orderBy: { createdAt: 'desc' } },
      events: { orderBy: { occurredAt: 'asc' } },
    } satisfies Prisma.OrderInclude;
  }

  private async findOrderForOwner(userId: string, id: string) {
    const where = this.resolveOrderWhere(id);
    if (!where) throw new NotFoundException(`Không tìm thấy đơn hàng có ID ${id}`);
    const order = await this.prisma.order.findFirst({ where: { ...where, userId }, include: this.orderInclude() });
    if (!order) throw new NotFoundException(`Không tìm thấy đơn hàng có ID ${id}`);
    return order;
  }

  private async findOrderByIdentifier(id: string) {
    const where = this.resolveOrderWhere(id);
    return where ? this.prisma.order.findFirst({ where, include: this.orderInclude() }) : null;
  }

  private async assertNoOpenMeasurementReviews(orderId: string) {
    const items = await this.prisma.orderItem.findMany({ where: { orderId }, select: { measurementReview: true } });
    const hasOpen = items.some((item) => {
      const review = item.measurementReview as { status?: string } | null;
      return review?.status === 'OPEN';
    });
    if (hasOpen) {
      throw new BadRequestException('Còn yêu cầu bổ sung số đo chưa được khách gửi lại.');
    }
  }

  private createOrderEvent(tx: Prisma.TransactionClient, data: {
    orderId: string;
    shipmentId?: string;
    type: string;
    source: string;
    actorId?: string;
    fromStatus?: OrderStatus;
    toStatus?: OrderStatus;
    fromShipmentStatus?: ShipmentStatus;
    toShipmentStatus?: ShipmentStatus;
    publicMessage?: string;
    internalNote?: string;
    deduplicationKey?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    return tx.orderEvent.create({
      data: {
        orderId: data.orderId,
        shipmentId: data.shipmentId,
        type: data.type,
        source: data.source,
        actorId: data.actorId,
        fromStatus: data.fromStatus,
        toStatus: data.toStatus,
        fromShipmentStatus: data.fromShipmentStatus,
        toShipmentStatus: data.toShipmentStatus,
        publicMessage: data.publicMessage,
        internalNote: data.internalNote,
        deduplicationKey: data.deduplicationKey,
        metadata: data.metadata,
      },
    }).catch((err) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    });
  }

  private async notifyAdminsNewOrder(order: { id: string; orderCode: number; totalVnd: bigint | null }, customerName: string) {
    const admins = await this.prisma.user.findMany({
      where: { role: Role.ADMIN },
      select: { id: true },
    });

    const totalAmount = order.totalVnd ? (Number(order.totalVnd) / 1000).toFixed(0) + 'k' : '0k';
    for (const admin of admins) {
      await this.notificationService.create({
        userId: admin.id,
        type: NotificationType.ORDER_STATUS,
        title: 'Đơn hàng mới',
        message: `${customerName} vừa đặt đơn #${order.orderCode} (${totalAmount}đ)`,
        data: { orderId: order.id, orderCode: order.orderCode, type: 'NEW_ORDER' },
      });
    }
  }

  private async notifyAdminOrderCancelled(order: { id: string; orderCode: number; totalVnd: bigint | null }, customerName: string) {
    const admins = await this.prisma.user.findMany({
      where: { role: Role.ADMIN },
      select: { id: true },
    });

    const totalAmount = order.totalVnd ? (Number(order.totalVnd) / 1000).toFixed(0) + 'k' : '0k';
    for (const admin of admins) {
      await this.notificationService.create({
        userId: admin.id,
        type: NotificationType.ORDER_STATUS,
        title: 'Đơn hàng bị hủy',
        message: `${customerName} đã hủy đơn #${order.orderCode} (${totalAmount}đ)`,
        data: { orderId: order.id, orderCode: order.orderCode, type: 'ORDER_CANCELLED' },
      });
    }
  }

  private toPublicOrder(order: IOrderWithRelations) {
    const itemsTotal = (order.items ?? []).reduce(
      (sum, item) => sum + Number(item.price) * item.quantity,
      0,
    );
    return {
      id: order.id,
      orderCode: order.orderCode,
      userId: order.userId,
      targetTier: order.targetTier,
      amount: Number(order.amount),
      itemsTotal,
      status: order.status,
      paymentStatus: order.paymentStatus,
      refundStatus: order.refundStatus,
      fulfillmentFlowVersion: order.fulfillmentFlowVersion,
      shippingInfo: order.shippingInfo,
      paymentMethod: order.paymentMethod,
      paymentProvider: order.paymentProvider,
      shippingFee: order.shippingFee === null || order.shippingFee === undefined ? null : Number(order.shippingFee),
      discountAmount: order.discountAmount === null || order.discountAmount === undefined ? null : Number(order.discountAmount),
      couponCode: order.couponCode,
      checkoutUrl: order.checkoutUrl,
      checkoutExpiresAt: order.checkoutExpiresAt,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: (order.items ?? []).map((item) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        color: item.color,
        measurementSnapshot: item.measurementSnapshot,
        measurementReview: item.measurementReview,
        productNameSnapshot: item.productNameSnapshot,
        fabricSnapshot: item.fabricSnapshot,
        price: Number(item.price),
        product: item.product,
      })),
      payments: (order.payments ?? []).map((payment) => ({
        id: payment.id,
        provider: payment.provider,
        transactionId: payment.transactionId,
        createdAt: payment.createdAt,
      })),
      shipment: (order.shipments ?? [])[0]
        ? {
            id: order.shipments[0].id,
            provider: order.shipments[0].provider,
            providerOrderCode: order.shipments[0].providerOrderCode,
            status: order.shipments[0].status,
            rawStatus: order.shipments[0].rawStatus,
            shippingFeeVnd: order.shipments[0].shippingFeeVnd === null || order.shipments[0].shippingFeeVnd === undefined ? null : Number(order.shipments[0].shippingFeeVnd),
            shippingFee: order.shipments[0].shippingFee === null || order.shipments[0].shippingFee === undefined ? null : Number(order.shipments[0].shippingFee),
            quotedShippingFee: order.shipments[0].quotedShippingFee === null || order.shipments[0].quotedShippingFee === undefined ? null : Number(order.shipments[0].quotedShippingFee),
            actualShippingFee: order.shipments[0].actualShippingFee === null || order.shipments[0].actualShippingFee === undefined ? null : Number(order.shipments[0].actualShippingFee),
            expectedDeliveryTime: order.shipments[0].expectedDeliveryTime,
            lastSyncedAt: order.shipments[0].lastSyncedAt,
          }
        : null,
      history: (order.events ?? []).map((event) => ({
        id: event.id,
        type: event.type,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        source: event.source,
        occurredAt: event.occurredAt,
        publicMessage: event.publicMessage,
        shipmentId: event.shipmentId,
      })),
      allowedActions: {
        cancel: order.status === OrderStatus.PENDING && (!order.paymentStatus || order.paymentStatus === PaymentStatus.PENDING),
        updateMeasurement: order.status === OrderStatus.MEASUREMENT_REVIEW,
      },
      user: order.user,
    };
  }

  private buildShipmentInput(order: IOrderWithRelations) {
    const shippingInfo = (order.shippingInfo ?? {}) as {
      name?: string;
      phone?: string;
      address?: string;
      note?: string;
      notes?: string;
      provinceName?: string;
      districtName?: string;
      wardName?: string;
      ghnDistrictId?: number;
      ghnWardCode?: string;
      districtId?: number;
      wardCode?: string;
    };
    const items = order.items ?? [];
    const weight = Math.max(500, items.reduce((sum, item) => sum + item.quantity * 500, 0));
    return {
      orderId: order.id,
      clientOrderCode: `ORD-${order.orderCode}`,
      sender: { address: 'FashionAI workshop' },
      receiver: {
        name: shippingInfo.name,
        phone: shippingInfo.phone,
        address: shippingInfo.address || '',
        provinceName: shippingInfo.provinceName,
        districtName: shippingInfo.districtName,
        wardName: shippingInfo.wardName,
        districtId: shippingInfo.ghnDistrictId ?? shippingInfo.districtId,
        wardCode: shippingInfo.ghnWardCode ?? shippingInfo.wardCode,
      },
      items: items.map((item) => ({
        name: item.productNameSnapshot || item.product?.name || 'FashionAI item',
        code: item.productId,
        quantity: item.quantity,
        price: Number(item.price),
        weight: 500,
      })),
      weight,
      dimensions: { length: 25, width: 20, height: 8 },
      codAmount: 0,
      insuranceValue: Number(order.amount),
      note: shippingInfo.note ?? shippingInfo.notes,
    };
  }

  // Cho phép tra cứu bằng UUID (id) hoặc orderCode dạng số (có/không tiền tố ORD-).
  // Trả về null nếu định danh không hợp lệ để controller trả 404 sạch, tránh Prisma
  // ném lỗi cast UUID hoặc Int out-of-range (đều thành 500).
  private resolveOrderWhere(identifier: string): Prisma.OrderWhereInput | null {
    const value = identifier.trim();
    if (UUID_REGEX.test(value)) {
      return { id: value };
    }

    const numeric = Number(value.replace(/^ORD-/i, ''));
    if (Number.isInteger(numeric) && numeric > 0 && numeric <= MAX_INT4) {
      return { orderCode: numeric };
    }

    return null;
  }

}
