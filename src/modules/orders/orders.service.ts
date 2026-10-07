import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CouponDiscountType, GarmentType, NotificationType, OrderStatus, PaymentStatus, Prisma, Product, RefundStatus, Role, ShipmentStatus } from '@prisma/client';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { MailQueueService } from '../mail/mail-queue.service';
import { NotificationService } from '../notification/notification.service';
import { createWithUniqueOrderCode } from '../../common/utils/order-code.util';
import { resolveGarmentUrlForColor } from '../../common/utils/garment-image.util';
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
import { QueryAdminOrdersDto } from './dto/query-admin-orders.dto';
import { RefundOrderDto } from './dto/refund-order.dto';
import { CancelShipmentDto, CreateShipmentDto } from './dto/shipment.dto';
import { ShippingProviderType } from '../shipping/constants/shipping-provider.enum';
import { ShippingService } from '../shipping/shipping.service';
import { UserAddressesService } from '../users/user-addresses.service';
import {
  MEASUREMENT_LABELS,
  MeasurementField,
  REQUIRED_MEASUREMENTS_BY_CATEGORY,
  REQUIRED_MEASUREMENTS_BY_TYPE,
  getMissingMeasurements,
} from '../../common/constants/measurement.constants';
import { ONLINE_REFUND_PROVIDERS } from '../../common/constants/payment.constants';

type IOrderWithRelations = Prisma.OrderGetPayload<{
  include: ReturnType<OrdersService['orderInclude']>;
}> & { user?: unknown };
type IShipmentWithOrder = IOrderWithRelations['shipments'][number];

type IOrderProduct = Product;
type ResolvedCreateOrderDto = CreateOrderDto & { shippingInfo: NonNullable<CreateOrderDto['shippingInfo']> };
type FindUserOrdersOptions = {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
};
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
    const pricing = await this.buildOrderPricing(resolvedDto, products, userId);
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

    // Nếu sản phẩm có khai báo danh sách màu (colors), màu khách chọn phải khớp
    // 1 trong số đó (case-insensitive) — tránh lưu màu rác không map được ảnh.
    // Sản phẩm chưa khai báo colors thì giữ hành vi cũ (chấp nhận mọi string).
    for (const item of resolvedDto.items) {
      if (!item.color) continue;
      const product = productMap.get(item.productId)!;
      const colors = (product.colors as Array<{ name: string }> | null) ?? [];
      if (colors.length === 0) continue;
      const matched = colors.some(
        (c) => c.name.trim().toLowerCase() === item.color!.trim().toLowerCase(),
      );
      if (!matched) {
        throw new BadRequestException(
          `Màu "${item.color}" không hợp lệ cho sản phẩm "${product.name}"`,
        );
      }
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
    const { itemsTotal, shippingFee, discountAmount, total, couponCode, couponId, shippingQuote } =
      await this.buildOrderPricing(resolvedDto, products, userId);

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
            status: OrderStatus.CREATED,
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
                  productImageSnapshot: resolveGarmentUrlForColor(
                    (product as Product & { images?: { imageUrl: string; isMain: boolean; colorName: string | null }[] }).images ?? [],
                    product.garmentUrl,
                    item.color,
                  ),
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
          toStatus: OrderStatus.CREATED,
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

        if (couponId) {
          await tx.couponRedemption.create({
            data: { couponId, userId, orderId: created.id },
          });
          await tx.coupon.update({
            where: { id: couponId },
            data: { usedCount: { increment: 1 } },
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

  async findAll(userId: string, options: FindUserOrdersOptions = {}) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
    const skip = (page - 1) * limit;
    const status = options.status && Object.values(OrderStatus).includes(options.status as OrderStatus)
      ? options.status as OrderStatus
      : undefined;
    const search = options.search?.trim();
    const numericSearch = search ? Number(search.replace(/^ORD-/i, '')) : NaN;

    const where: Prisma.OrderWhereInput = {
      userId,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              ...(Number.isInteger(numericSearch) && numericSearch > 0 && numericSearch <= MAX_INT4
                ? [{ orderCode: numericSearch }]
                : []),
              {
                items: {
                  some: {
                    product: {
                      name: { contains: search, mode: 'insensitive' },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: this.orderInclude(),
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: orders.map((order) => this.toPublicOrder(order)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(userId: string, id: string, isAdmin = false) {
    const where = this.resolveOrderWhere(id);
    if (!where) {
      throw new NotFoundException(`Không tìm thấy đơn hàng có ID ${id}`);
    }

    const order = await this.prisma.order.findFirst({
      where: isAdmin ? where : { ...where, userId },
      include: this.orderInclude(),
    });

    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng có ID ${id}`);
    }

    return this.toPublicOrder(order);
  }

  async cancel(userId: string, id: string) {
    const order = await this.findOrderForOwner(userId, id);
    if (order.status !== OrderStatus.CREATED) {
      throw new BadRequestException('Chỉ có thể hủy đơn hàng đang chờ xử lý');
    }

    // updateMany + điều kiện status để hai request hủy đồng thời (hoặc hủy đúng
    // lúc webhook ghi PAID) không cùng thắng. Dùng order.id (UUID đã phân giải)
    // thay vì param thô để tránh lỗi cast khi client gửi orderCode.
    const { count } = await this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: order.id, userId, status: OrderStatus.CREATED, OR: [{ paymentStatus: PaymentStatus.PENDING }, { paymentStatus: null }] },
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
          fromStatus: OrderStatus.CREATED,
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

  async findAllAdmin(query: QueryAdminOrdersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const andFilters: Prisma.OrderWhereInput[] = [];

    if (query.status) {
      andFilters.push({ status: query.status });
    }
    if (query.paymentStatus) {
      andFilters.push({ paymentStatus: query.paymentStatus });
    }
    if (query.fromDate || query.toDate) {
      andFilters.push({
        createdAt: {
          ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
          ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
        },
      });
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      const orderCode = Number(search.replace(/^ORD-/i, ''));
      andFilters.push({
        OR: [
          ...(Number.isInteger(orderCode) && orderCode > 0 && orderCode <= MAX_INT4 ? [{ orderCode }] : []),
          { user: { name: { contains: search, mode: Prisma.QueryMode.insensitive } } },
          { user: { email: { contains: search, mode: Prisma.QueryMode.insensitive } } },
        ],
      });
    }

    const where: Prisma.OrderWhereInput = andFilters.length > 0 ? { AND: andFilters } : {};

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
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
      this.prisma.order.count({ where }),
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

    const verifiedOnlyStatuses: OrderStatus[] = [OrderStatus.SHIPPING, OrderStatus.DELIVERED, OrderStatus.PAID, OrderStatus.CREATED];
    if (isNewFlow && verifiedOnlyStatuses.includes(status)) {
      throw new BadRequestException('Trạng thái này phải do thanh toán hoặc vận chuyển đã xác minh cập nhật.');
    }

    if (isNewFlow && status === OrderStatus.PROCESSING && order.status === OrderStatus.MEASUREMENT_REVIEW) {
      await this.assertNoOpenMeasurementReviews(order.id);
    }

    await this.prisma.$transaction(async (tx) => {
      if (isNewFlow && status === OrderStatus.PROCESSING && order.status === OrderStatus.MEASUREMENT_REVIEW) {
        await this.resolveSubmittedMeasurementReviews(tx, order.id);
      }
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
    if (order.fulfillmentFlowVersion !== 1 || order.status !== OrderStatus.PROCESSING) {
      throw new BadRequestException('Chỉ mở yêu cầu số đo khi đơn đang ở bước kiểm tra số đo.');
    }

    const review = { status: 'OPEN', message: dto.message, openedAt: new Date().toISOString() };
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.MEASUREMENT_REVIEW } });
      await tx.orderItem.update({ where: { id: item.id }, data: { measurementReview: review as Prisma.InputJsonValue } });
      await this.createOrderEvent(tx, { orderId: order.id, type: 'MEASUREMENT_REVIEW_OPENED', source: 'ADMIN', actorId, fromStatus: OrderStatus.PROCESSING, toStatus: OrderStatus.MEASUREMENT_REVIEW, publicMessage: dto.message, internalNote: dto.internalNote });
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

    const refundablePaymentStatuses: PaymentStatus[] = [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED];
    const hasOnlineOrderPayment = order.payments?.some((payment) => {
      const paymentData = payment.paymentData as { refundScope?: string } | null;
      return ONLINE_REFUND_PROVIDERS.includes(payment.provider as (typeof ONLINE_REFUND_PROVIDERS)[number])
        && paymentData?.refundScope !== 'PAYMENT_ONLY'
        && refundablePaymentStatuses.includes(payment.status);
    });
    if (hasOnlineOrderPayment && dto.refundStatus === RefundStatus.COMPLETED) {
      throw new BadRequestException('Không được xác nhận hoàn tiền online thủ công. Vui lòng dùng endpoint hoàn tiền trong Payments.');
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
          where: { orderId: order.id, provider: 'MANUAL', status: { notIn: ['CANCELLED'] } },
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
    const shipmentCreatableStatuses: OrderStatus[] = [OrderStatus.PROCESSING, OrderStatus.READY_TO_SHIP];
    if (order.fulfillmentFlowVersion !== 1 || !shipmentCreatableStatuses.includes(order.status) || order.paymentStatus !== PaymentStatus.PAID) {
      throw new BadRequestException('Chỉ tạo vận đơn cho đơn may đo PROCESSING/READY_TO_SHIP đã thanh toán.');
    }
    if (order.status === OrderStatus.PROCESSING) {
      await this.assertNoOpenMeasurementReviews(order.id);
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
          rawStatus: result.rawStatus ?? 'ready_to_pick',
          providerOrderCode: result.providerOrderCode,
          shippingFee: new Prisma.Decimal(result.shippingFee),
          shippingFeeVnd: BigInt(Math.round(result.shippingFee)),
          actualShippingFee: new Prisma.Decimal(result.shippingFee),
          expectedDeliveryTime: result.expectedDeliveryTime,
          trackingData: result.raw as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
        },
      });
      if (order.status === OrderStatus.PROCESSING) {
        await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.READY_TO_SHIP } });
      }
      await this.createOrderEvent(tx, { orderId: order.id, shipmentId: created.id, type: 'SHIPMENT_CREATED', source: 'ADMIN', actorId, fromStatus: order.status, toStatus: OrderStatus.READY_TO_SHIP, fromShipmentStatus: pendingShipment.status, toShipmentStatus: result.status, publicMessage: 'Vận đơn đã được tạo và đang chờ đơn vị vận chuyển xử lý.', deduplicationKey: `shipment:${requestKey}:created`, metadata: { rawStatus: result.rawStatus ?? 'ready_to_pick' } as Prisma.InputJsonValue });
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
    if (order.status === OrderStatus.COMPLETED) {
      return this.toPublicOrder(order);
    }
    if (order.status !== OrderStatus.READY_TO_SHIP) {
      throw new BadRequestException('Chỉ có thể xác nhận khi đơn hàng đã sẵn sàng giao và vận đơn đã giao thành công.');
    }
    const currentShipment = this.getCurrentShipment(order);
    if (!currentShipment || this.normalizeRawStatus(currentShipment.rawStatus) !== 'delivered') {
      throw new BadRequestException('Chỉ có thể xác nhận sau khi đơn vị vận chuyển báo đã giao hàng.');
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
      include: { images: true },
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

  private async buildOrderPricing(dto: ResolvedCreateOrderDto, products: IOrderProduct[], userId: string) {
    const productMap = new Map(products.map((product) => [product.id, product]));
    const itemsTotal = dto.items.reduce((sum, item) => {
      const product = productMap.get(item.productId)!;
      return sum + Number(product.price) * item.quantity;
    }, 0);
    const shippingQuote = await this.calculateOrderShippingFee(dto, itemsTotal);
    const shippingFee = shippingQuote.totalFee;
    const { discountAmount, couponId, couponCode } = await this.resolveDiscountAmount(dto.couponCode, itemsTotal, userId);

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
      couponId,
      couponCode: discountAmount > 0 ? couponCode : undefined,
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

  private async resolveDiscountAmount(
    couponCode: string | undefined,
    itemsTotal: number,
    userId: string,
  ): Promise<{ discountAmount: number; couponId: string | null; couponCode?: string }> {
    const code = couponCode?.trim().toUpperCase();
    if (!code) return { discountAmount: 0, couponId: null };

    const coupon = await this.prisma.coupon.findUnique({ where: { code } });
    if (!coupon) {
      throw new BadRequestException('Mã giảm giá không tồn tại');
    }
    if (!coupon.isActive) {
      throw new BadRequestException('Mã giảm giá đã bị tắt');
    }

    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
      throw new BadRequestException('Mã giảm giá chưa đến thời gian áp dụng');
    }
    if (coupon.expiresAt && coupon.expiresAt < now) {
      throw new BadRequestException('Mã giảm giá đã hết hạn');
    }
    if (coupon.minOrderVnd !== null && itemsTotal < Number(coupon.minOrderVnd)) {
      throw new BadRequestException('Đơn hàng chưa đạt giá trị tối thiểu để áp mã này');
    }
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      throw new BadRequestException('Mã giảm giá đã hết lượt sử dụng');
    }
    if (coupon.usageLimitPerUser !== null) {
      const usedByUser = await this.prisma.couponRedemption.count({
        where: { couponId: coupon.id, userId },
      });
      if (usedByUser >= coupon.usageLimitPerUser) {
        throw new BadRequestException('Bạn đã sử dụng hết số lượt cho phép của mã giảm giá này');
      }
    }

    let discountAmount: number;
    if (coupon.discountType === CouponDiscountType.PERCENTAGE) {
      discountAmount = Math.round((itemsTotal * Number(coupon.discountValue)) / 100);
      if (coupon.maxDiscountVnd !== null) {
        discountAmount = Math.min(discountAmount, Number(coupon.maxDiscountVnd));
      }
    } else {
      discountAmount = Math.min(Number(coupon.discountValue), itemsTotal);
    }

    return { discountAmount, couponId: coupon.id, couponCode: coupon.code };
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

  // measurementSnapshot lưu đủ 16 field cho MỌI item bất kể loại trang phục (xem
  // buildMeasurementSnapshot). Hàm này lọc lại chỉ còn field thợ cần cho đúng
  // garmentType của item đó, kèm nhãn tiếng Việt + đơn vị, để hiển thị cho admin/thợ
  // may mà không phải tự tra 16 field thô. Không đổi cách lưu, chỉ lọc ở tầng response.
  private buildMeasurementDisplay(item: {
    measurementSnapshot: Prisma.JsonValue;
    productCategorySnapshot: string | null;
    product?: { category: string; garmentType: string | null } | null;
  }): Array<{ field: string; label: string; value: number; unit: string }> {
    const snapshot = item.measurementSnapshot as Partial<Record<MeasurementField, unknown>> | null;
    if (!snapshot) return [];

    const garmentType = item.product?.garmentType;
    const requiredFields: readonly MeasurementField[] =
      garmentType && garmentType in REQUIRED_MEASUREMENTS_BY_TYPE
        ? REQUIRED_MEASUREMENTS_BY_TYPE[garmentType as GarmentType]
        : REQUIRED_MEASUREMENTS_BY_CATEGORY[
            (item.product?.category ?? item.productCategorySnapshot) as keyof typeof REQUIRED_MEASUREMENTS_BY_CATEGORY
          ] ?? [];

    return requiredFields
      .filter((field) => snapshot[field] !== null && snapshot[field] !== undefined)
      .map((field) => ({
        field,
        label: MEASUREMENT_LABELS[field],
        value: Number(snapshot[field]),
        unit: 'cm',
      }));
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
      refunds: true,
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
      throw new BadRequestException('Còn yêu cầu bổ sung số đo chưa được xử lý xong.');
    }
  }

  private async resolveSubmittedMeasurementReviews(tx: Prisma.TransactionClient, orderId: string) {
    const items = await tx.orderItem.findMany({ where: { orderId }, select: { id: true, measurementReview: true } });
    for (const item of items) {
      const review = item.measurementReview as { status?: string; [key: string]: unknown } | null;
      if (review?.status === 'SUBMITTED') {
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            measurementReview: { ...review, status: 'RESOLVED', resolvedAt: new Date().toISOString() } as Prisma.InputJsonValue,
          },
        });
      }
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
    const currentShipment = this.getCurrentShipment(order);
    const activeShipment = this.getActiveShipment(order);
    const displayStatus = this.resolveDisplayStatus(order, currentShipment);
    return {
      id: order.id,
      orderCode: order.orderCode,
      userId: order.userId,
      targetTier: order.targetTier,
      amount: Number(order.amount),
      itemsTotal,
      status: order.status,
      displayStatus,
      paymentStatus: order.paymentStatus,
      refundStatus: order.refundStatus,
      fulfillmentFlowVersion: order.fulfillmentFlowVersion,
      shippingInfo: order.shippingInfo,
      paymentMethod: order.paymentMethod,
      paymentProvider: order.paymentProvider,
      shippingFee: order.shippingFee === null || order.shippingFee === undefined ? null : Number(order.shippingFee),
      discountAmount: order.discountAmount === null || order.discountAmount === undefined ? null : Number(order.discountAmount),
      couponCode: order.couponCode,
      currency: order.currency,
      itemsSubtotalVnd: order.itemsSubtotalVnd === null || order.itemsSubtotalVnd === undefined ? null : Number(order.itemsSubtotalVnd),
      shippingFeeVnd: order.shippingFeeVnd === null || order.shippingFeeVnd === undefined ? null : Number(order.shippingFeeVnd),
      discountVnd: order.discountVnd === null || order.discountVnd === undefined ? null : Number(order.discountVnd),
      taxVnd: order.taxVnd === null || order.taxVnd === undefined ? null : Number(order.taxVnd),
      totalVnd: order.totalVnd === null || order.totalVnd === undefined ? null : Number(order.totalVnd),
      amountPaidVnd: Number(order.amountPaidVnd),
      amountRefundedVnd: Number(order.amountRefundedVnd),
      shippingAddressSnapshot: order.shippingAddressSnapshot,
      shippingQuoteSnapshot: order.shippingQuoteSnapshot,
      refundEvidence: order.refundEvidence,
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
        measurementDisplay: this.buildMeasurementDisplay(item),
        measurementReview: item.measurementReview,
        productNameSnapshot: item.productNameSnapshot,
        productSkuSnapshot: item.productSkuSnapshot,
        productImageSnapshot: item.productImageSnapshot,
        productCategorySnapshot: item.productCategorySnapshot,
        brandSnapshot: item.brandSnapshot,
        fabricSnapshot: item.fabricSnapshot,
        price: Number(item.price),
        unitPriceVnd: item.unitPriceVnd === null || item.unitPriceVnd === undefined ? null : Number(item.unitPriceVnd),
        lineTotalVnd: item.lineTotalVnd === null || item.lineTotalVnd === undefined ? null : Number(item.lineTotalVnd),
        product: item.product,
      })),
      payments: (order.payments ?? []).map((payment) => ({
        id: payment.id,
        provider: payment.provider,
        transactionId: payment.transactionId,
        status: payment.status,
        amountVnd: payment.amountVnd === null || payment.amountVnd === undefined ? null : Number(payment.amountVnd),
        createdAt: payment.createdAt,
      })),
      refunds: (order.refunds ?? []).map((refund) => ({
        id: refund.id,
        paymentId: refund.paymentId,
        provider: refund.provider,
        amountVnd: Number(refund.amountVnd),
        reason: refund.reason,
        status: refund.status,
        requestedAt: refund.requestedAt,
        processedAt: refund.processedAt,
        failedReason: refund.failedReason,
      })),
      activeShipment: activeShipment ? this.toPublicShipment(activeShipment) : null,
      currentShipment: currentShipment ? this.toPublicShipment(currentShipment) : null,
      shipmentHistory: (order.shipments ?? []).map((shipment) => this.toPublicShipment(shipment)),
      shipment: currentShipment ? this.toPublicShipment(currentShipment) : null,
      history: (order.events ?? []).map((event) => ({
        id: event.id,
        type: event.type,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        source: event.source,
        occurredAt: event.occurredAt,
        publicMessage: event.publicMessage,
        shipmentId: event.shipmentId,
        fromShipmentStatus: event.fromShipmentStatus,
        toShipmentStatus: event.toShipmentStatus,
        metadata: event.metadata,
      })),
      allowedActions: {
        cancel: order.status === OrderStatus.CREATED && (!order.paymentStatus || order.paymentStatus === PaymentStatus.PENDING),
        confirmDelivery: order.status === OrderStatus.READY_TO_SHIP && this.normalizeRawStatus(this.getCurrentShipment(order)?.rawStatus) === 'delivered',
        startShipmentCreation: order.status === OrderStatus.PROCESSING && order.paymentStatus === PaymentStatus.PAID,
        createReplacementShipment: order.status === OrderStatus.READY_TO_SHIP && !this.getActiveShipment(order),
        updateMeasurement: order.status === OrderStatus.MEASUREMENT_REVIEW,
      },
      user: order.user,
    };
  }

  private getCurrentShipment(order: IOrderWithRelations) {
    return (order.shipments ?? [])[0] ?? null;
  }

  private getActiveShipment(order: IOrderWithRelations) {
    return (order.shipments ?? []).find((shipment) => {
      const rawStatus = this.normalizeRawStatus(shipment.rawStatus);
      const terminalStatuses: ShipmentStatus[] = [
        ShipmentStatus.DELIVERED,
        ShipmentStatus.RETURNED,
        ShipmentStatus.CANCELLED,
        ShipmentStatus.FAILED,
      ];
      return !terminalStatuses.includes(shipment.status) && !['delivered', 'returned', 'cancel'].includes(rawStatus);
    }) ?? null;
  }

  private toPublicShipment(shipment: IShipmentWithOrder) {
    return {
      id: shipment.id,
      provider: shipment.provider,
      providerOrderCode: shipment.providerOrderCode,
      status: shipment.status,
      rawStatus: shipment.rawStatus,
      shippingFeeVnd: shipment.shippingFeeVnd === null || shipment.shippingFeeVnd === undefined ? null : Number(shipment.shippingFeeVnd),
      shippingFee: shipment.shippingFee === null || shipment.shippingFee === undefined ? null : Number(shipment.shippingFee),
      quotedShippingFee: shipment.quotedShippingFee === null || shipment.quotedShippingFee === undefined ? null : Number(shipment.quotedShippingFee),
      actualShippingFee: shipment.actualShippingFee === null || shipment.actualShippingFee === undefined ? null : Number(shipment.actualShippingFee),
      expectedDeliveryTime: shipment.expectedDeliveryTime,
      providerEventAt: shipment.providerEventAt,
      lastSyncedAt: shipment.lastSyncedAt,
      createdAt: shipment.createdAt,
      updatedAt: shipment.updatedAt,
    };
  }

  private resolveDisplayStatus(order: IOrderWithRelations, currentShipment: IShipmentWithOrder | null) {
    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.COMPLETED) {
      return {
        source: 'ORDER',
        code: order.status,
        label: this.labelOrderStatus(order.status),
        providerTerminal: false,
        orderFinal: true,
        issue: false,
      };
    }

    if (currentShipment?.providerOrderCode) {
      const rawCode = this.normalizeRawStatus(currentShipment.rawStatus) || String(currentShipment.status).toLowerCase();
      const catalog = this.ghnStatusCatalog(rawCode);
      return {
        source: currentShipment.provider || 'GHN',
        code: currentShipment.rawStatus ?? rawCode,
        label: catalog.label,
        providerTerminal: catalog.providerTerminal,
        orderFinal: false,
        issue: catalog.issue,
      };
    }

    return {
      source: 'ORDER',
      code: order.status,
      label: this.labelOrderStatus(order.status),
      providerTerminal: false,
      orderFinal: false,
      issue: false,
    };
  }

  private normalizeRawStatus(status?: string | null) {
    return (status ?? '').trim().toLowerCase();
  }

  private labelOrderStatus(status: OrderStatus) {
    return ORDER_STATUS_MESSAGE[status] ?? status;
  }

  private ghnStatusCatalog(status: string) {
    const labels: Record<string, { label: string; providerTerminal: boolean; issue: boolean }> = {
      ready_to_pick: { label: 'Chờ lấy hàng', providerTerminal: false, issue: false },
      picking: { label: 'Đang lấy hàng', providerTerminal: false, issue: false },
      money_collect_picking: { label: 'Đang thu tiền khi lấy hàng', providerTerminal: false, issue: false },
      picked: { label: 'Đã lấy hàng', providerTerminal: false, issue: false },
      storing: { label: 'Đang lưu kho', providerTerminal: false, issue: false },
      sorting: { label: 'Đang phân loại', providerTerminal: false, issue: false },
      transporting: { label: 'Đang trung chuyển', providerTerminal: false, issue: false },
      delivering: { label: 'Đang giao hàng', providerTerminal: false, issue: false },
      money_collect_delivering: { label: 'Đang thu tiền khi giao hàng', providerTerminal: false, issue: false },
      delivered: { label: 'Đã giao hàng', providerTerminal: true, issue: false },
      delivery_fail: { label: 'Giao hàng không thành công', providerTerminal: false, issue: true },
      waiting_to_return: { label: 'Chờ hoàn hàng', providerTerminal: false, issue: false },
      return: { label: 'Đang hoàn hàng', providerTerminal: false, issue: false },
      return_transporting: { label: 'Đang trung chuyển hoàn hàng', providerTerminal: false, issue: false },
      return_sorting: { label: 'Đang phân loại hoàn hàng', providerTerminal: false, issue: false },
      returning: { label: 'Đang trả hàng', providerTerminal: false, issue: false },
      return_fail: { label: 'Hoàn hàng không thành công', providerTerminal: false, issue: true },
      returned: { label: 'Đã hoàn hàng', providerTerminal: true, issue: false },
      cancel: { label: 'Vận đơn đã hủy', providerTerminal: true, issue: false },
      exception: { label: 'Vận đơn gặp sự cố', providerTerminal: false, issue: true },
      lost: { label: 'Thất lạc hàng', providerTerminal: true, issue: true },
      damage: { label: 'Hàng bị hư hỏng', providerTerminal: true, issue: true },
      scrap: { label: 'Hàng bị hủy', providerTerminal: true, issue: true },
    };
    return labels[status] ?? { label: status || 'Trạng thái vận chuyển chưa xác định', providerTerminal: false, issue: false };
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
