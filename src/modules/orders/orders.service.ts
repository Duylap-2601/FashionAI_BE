import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationService } from '../notification/notification.service';
import { createWithUniqueOrderCode } from '../../common/utils/order-code.util';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  MEASUREMENT_LABELS,
  MeasurementField,
  getMissingMeasurements,
} from '../../common/constants/measurement.constants';

// Các trường số đo được chụp lại (snapshot) khi đặt đơn để thợ may theo. Đóng
// băng tại thời điểm đặt: user sửa số đo sau này không ảnh hưởng đơn cũ.
const MEASUREMENT_SNAPSHOT_FIELDS: MeasurementField[] = [
  'height',
  'weight',
  'chest',
  'waist',
  'hip',
  'shoulder',
  'neck',
  'sleeveLength',
  'wrist',
  'thigh',
  'knee',
  'calf',
  'inseam',
  'outseam',
  'shirtLength',
  'underbust',
];

/**
 * UUID chuẩn cho cột id; dùng để phân biệt tra cứu theo id (UUID) hay orderCode.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// orderCode là Postgres Int4 (tối đa 2^31 - 1). Chặn giá trị vượt ngưỡng để tránh
// Prisma ném lỗi out-of-range (thành 500) khi client gửi số quá lớn.
const MAX_INT4 = 2_147_483_647;

/**
 * Luồng trạng thái đơn hàng hợp lệ cho admin. PENDING -> PAID do webhook thanh
 * toán online đảm nhiệm (processOrderSuccess), không phải admin. Admin có thể xác
 * nhận (CONFIRMED) đơn PENDING để phục vụ đơn COD vốn không có webhook thanh toán.
 */
const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED,
    OrderStatus.EXPIRED,
    OrderStatus.FAILED,
  ],
  [OrderStatus.PAID]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.SHIPPING, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPING]: [OrderStatus.DELIVERED, OrderStatus.RETURNED],
  [OrderStatus.DELIVERED]: [OrderStatus.RETURNED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.RETURNED]: [],
  [OrderStatus.EXPIRED]: [],
  [OrderStatus.FAILED]: [],
};

// Trạng thái mà tồn kho đã bị trừ: hoàn kho khi hủy/hoàn hàng từ các trạng thái này.
const STOCK_DECREMENTED_STATES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.CONFIRMED,
  OrderStatus.SHIPPING,
  OrderStatus.DELIVERED,
];

// Trạng thái cần gửi email thông báo cho người dùng.
const STATUS_NOTIFY_EMAIL: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.CANCELLED,
];

// Mô tả trạng thái đơn bằng tiếng Việt cho notification realtime.
const ORDER_STATUS_MESSAGE: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.PAID]: 'Đơn hàng đã được thanh toán.',
  [OrderStatus.CONFIRMED]: 'Đơn hàng đã được xác nhận và đang chuẩn bị.',
  [OrderStatus.SHIPPING]: 'Đơn hàng đang được giao đến bạn.',
  [OrderStatus.DELIVERED]: 'Đơn hàng đã được giao thành công.',
  [OrderStatus.CANCELLED]: 'Đơn hàng đã bị hủy.',
  [OrderStatus.RETURNED]: 'Đơn hàng đã được hoàn trả.',
  [OrderStatus.EXPIRED]: 'Đơn hàng đã hết hạn thanh toán.',
  [OrderStatus.FAILED]: 'Đơn hàng thanh toán thất bại.',
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly notificationService: NotificationService,
  ) {}

  async create(userId: string, dto: CreateOrderDto) {
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
        `Sản phẩm không tồn tại hoặc chưa active: ${missingIds.join(', ')}`,
      );
    }

    // Kiểm tra tồn kho (stock là Int NOT NULL nên luôn có giá trị).
    for (const item of dto.items) {
      const product = productMap.get(item.productId)!;
      if (product.stock < item.quantity) {
        throw new BadRequestException(
          `Sản phẩm "${product.name}" chỉ còn ${product.stock} trong kho`,
        );
      }
    }

    // Đặt may theo số đo: user phải điền đủ số đo cơ thể bắt buộc cho tất cả phân
    // loại trang phục trong đơn thì mới đặt được. Chụp lại (snapshot) số đo lên
    // từng OrderItem để đóng băng tại thời điểm đặt.
    const measurement = await this.prisma.measurement.findUnique({
      where: { userId },
    });
    const orderedCategories = new Set(products.map((p) => p.category));
    const missingFields = getMissingMeasurements(
      measurement as Partial<Record<MeasurementField, unknown>> | null,
      orderedCategories,
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
    const itemsTotal = dto.items.reduce((sum, item) => {
      const product = productMap.get(item.productId)!;
      return sum + Number(product.price) * item.quantity;
    }, 0);

    const shippingFee = dto.shippingFee ?? 0;
    const discountAmount = dto.discountAmount ?? 0;

    // Chặn việc dùng giảm giá để đưa đơn về 0 đồng.
    if (discountAmount > itemsTotal + shippingFee) {
      throw new BadRequestException('Số tiền giảm giá vượt quá giá trị đơn hàng');
    }

    const total = itemsTotal + shippingFee - discountAmount;

    if (total <= 0) {
      throw new BadRequestException('Giá trị đơn hàng phải lớn hơn 0');
    }

    // totalAmount giờ là double-check thực sự: FE phải khớp tổng BE tính từ giá server.
    if (dto.totalAmount !== undefined && dto.totalAmount !== total) {
      throw new BadRequestException(`Tổng tiền không khớp: FE gửi ${dto.totalAmount}, BE tính ${total}`);
    }

    // Prepare shipping info with note/notes compatibility
    const shippingInfo = {
      ...dto.shippingInfo,
      note: dto.shippingInfo.note ?? dto.shippingInfo.notes ?? '',
    };

    return createWithUniqueOrderCode((orderCode) =>
      this.prisma.order.create({
        data: {
          orderCode,
          userId,
          amount: new Prisma.Decimal(total),
          status: OrderStatus.PENDING,
          shippingInfo: shippingInfo as unknown as Prisma.InputJsonValue,
          paymentMethod: dto.paymentMethod ?? 'COD',
          shippingFee: new Prisma.Decimal(shippingFee),
          discountAmount: new Prisma.Decimal(discountAmount),
          couponCode: dto.couponCode,
          items: {
            create: dto.items.map((item) => {
              const product = productMap.get(item.productId)!;
              return {
                productId: item.productId,
                quantity: item.quantity,
                color: item.color,
                measurementSnapshot:
                  measurementSnapshot as Prisma.InputJsonValue,
                // Chốt giá server tại thời điểm đặt hàng: đổi giá sản phẩm sau này
                // không ảnh hưởng đơn cũ, và client không thể tự đặt giá.
                price: product.price,
              };
            }),
          },
        },
        include: this.orderInclude(),
      }),
    );
  }

  async findAll(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: this.orderInclude(),
    });
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

    return order;
  }

  async cancel(userId: string, id: string) {
    const order = await this.findOne(userId, id);
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Chỉ có thể hủy đơn hàng đang chờ xử lý');
    }

    // updateMany + điều kiện status để hai request hủy đồng thời (hoặc hủy đúng
    // lúc webhook ghi PAID) không cùng thắng. Dùng order.id (UUID đã phân giải)
    // thay vì param thô để tránh lỗi cast khi client gửi orderCode.
    const { count } = await this.prisma.order.updateMany({
      where: { id: order.id, userId, status: OrderStatus.PENDING },
      data: {
        status: OrderStatus.CANCELLED,
        checkoutUrl: null,
        checkoutExpiresAt: null,
      },
    });

    if (count === 0) {
      throw new BadRequestException(
        'Đơn hàng vừa được cập nhật trạng thái, không thể hủy. Vui lòng tải lại.',
      );
    }

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
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async updateStatus(id: string, status: OrderStatus) {
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
      return this.prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: this.orderInclude(),
      });
    }

    const allowed = ORDER_STATUS_TRANSITIONS[order.status];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Không thể chuyển đơn hàng từ ${order.status} sang ${status}.` +
          (allowed.length > 0
            ? ` Trạng thái hợp lệ: ${allowed.join(', ')}.`
            : ' Đây là trạng thái kết thúc.'),
      );
    }

    // Đơn nâng cấp gói (subscription) có targetTier và không có item sản phẩm nên
    // bỏ qua toàn bộ logic tồn kho.
    const isProductOrder = order.targetTier === null;

    // Đơn COD trừ kho tại CONFIRMED (đơn online đã trừ ở PAID qua webhook). Kiểm
    // tra tồn đủ trước khi trừ, thiếu thì báo lỗi để admin biết mà xử lý.
    const shouldDecrement =
      isProductOrder &&
      status === OrderStatus.CONFIRMED &&
      order.status === OrderStatus.PENDING;

    // Hoàn tồn kho khi đơn ĐÃ trừ kho bị hủy hoặc hoàn hàng. Đơn PENDING chưa trừ
    // kho nên không cần hoàn.
    const shouldRestock =
      isProductOrder &&
      (status === OrderStatus.CANCELLED || status === OrderStatus.RETURNED) &&
      STOCK_DECREMENTED_STATES.includes(order.status);

    if (shouldDecrement) {
      const items = await this.prisma.orderItem.findMany({
        where: { orderId: order.id },
        include: { product: { select: { name: true, stock: true } } },
      });
      for (const item of items) {
        if (item.product.stock < item.quantity) {
          throw new BadRequestException(
            `Sản phẩm "${item.product.name}" chỉ còn ${item.product.stock} trong kho, không đủ để xác nhận đơn`,
          );
        }
      }
      await this.prisma.$transaction([
        this.prisma.order.update({ where: { id: order.id }, data: { status } }),
        ...items.map((item) =>
          this.prisma.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: item.quantity } },
          }),
        ),
      ]);
    } else if (shouldRestock) {
      const items = await this.prisma.orderItem.findMany({
        where: { orderId: order.id },
      });
      await this.prisma.$transaction([
        this.prisma.order.update({ where: { id: order.id }, data: { status } }),
        ...items.map((item) =>
          this.prisma.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          }),
        ),
      ]);
    } else {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status },
      });
    }

    // Gửi email thông báo cho user; lỗi email không được làm hỏng luồng cập nhật.
    if (STATUS_NOTIFY_EMAIL.includes(status) && order.user?.email) {
      this.mailService
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

    return this.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: this.orderInclude(),
    });
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
    } satisfies Prisma.OrderInclude;
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
