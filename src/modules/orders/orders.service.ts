import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { createWithUniqueOrderCode } from '../../common/utils/order-code.util';
import { CreateOrderDto } from './dto/create-order.dto';

/**
 * Luồng trạng thái đơn hàng hợp lệ cho admin. PENDING -> PAID do webhook thanh
 * toán đảm nhiệm, không phải admin, nên PENDING chỉ cho phép hủy/hết hạn/thất bại.
 */
const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [
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

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

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

    const total = dto.items.reduce((sum, item) => {
      const product = productMap.get(item.productId);
      return sum + Number(product?.price ?? 0) * item.quantity;
    }, 0);

    if (total <= 0) {
      throw new BadRequestException('Giá trị đơn hàng phải lớn hơn 0');
    }

    return createWithUniqueOrderCode((orderCode) =>
      this.prisma.order.create({
        data: {
          orderCode,
          userId,
          amount: new Prisma.Decimal(total),
          status: OrderStatus.PENDING,
          shippingInfo: dto.shippingInfo as unknown as Prisma.InputJsonValue,
          items: {
            create: dto.items.map((item) => {
              const product = productMap.get(item.productId)!;
              return {
                productId: item.productId,
                quantity: item.quantity,
                size: item.size,
                color: item.color,
                // Chốt giá tại thời điểm đặt hàng để sau này admin đổi giá sản
                // phẩm không làm thay đổi đơn cũ.
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
    const order = await this.prisma.order.findFirst({
      where: { id, userId },
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
    // lúc webhook ghi PAID) không cùng thắng.
    const { count } = await this.prisma.order.updateMany({
      where: { id, userId, status: OrderStatus.PENDING },
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

    return this.findOne(userId, id);
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
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng có ID ${id}`);
    }

    if (order.status === status) {
      return this.prisma.order.findUniqueOrThrow({
        where: { id },
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

    return this.prisma.order.update({
      where: { id },
      data: { status },
      include: this.orderInclude(),
    });
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

}
