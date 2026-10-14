import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ComboType } from '../../common/constants/order.constants';
import { resolveGarmentUrlForColor } from '../../common/utils/garment-image.util';
import { resolveProductColor } from '../../common/utils/product-color.util';
import { RealtimeEmitter } from '../realtime/realtime.emitter';
import { CART_MAX_LINES, CART_MAX_QUANTITY, CART_UPDATED_EVENT } from './constants/cart.constants';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { MergeCartDto } from './dto/merge-cart.dto';

const CART_ITEM_INCLUDE = {
  product: { include: { images: true } },
} satisfies Prisma.CartItemInclude;

type CartItemWithProduct = Prisma.CartItemGetPayload<{ include: typeof CART_ITEM_INCLUDE }>;

// Khoá của một dòng giỏ: color/comboType rỗng là "không chọn" (xem CartItem trong schema).
type CartLineKey = { productId: string; color: string; comboType: string };
type CartLine = CartLineKey & { quantity: number };

type PurchasedItem = {
  productId: string;
  quantity: number;
  color?: string | null;
  comboType?: string | null;
};

type MergeSkipReason = 'PRODUCT_UNAVAILABLE' | 'INVALID_COLOR' | 'CART_LINE_LIMIT';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeEmitter: RealtimeEmitter,
  ) {}

  async getCart(userId: string) {
    const items = await this.prisma.cartItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: CART_ITEM_INCLUDE,
    });
    return this.toCartResponse(items);
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    const line = await this.resolvePurchasableLine(this.toLineKey(dto));

    const where = { userId_productId_color_comboType: { userId, ...line } };
    const existing = await this.prisma.cartItem.findUnique({ where, select: { id: true } });
    // Giới hạn dòng là giới hạn mềm: hai thiết bị cùng thêm dòng mới lúc giỏ đang 49
    // dòng có thể vượt 50, khi đó tạo đơn sẽ báo vượt số dòng và user bỏ bớt.
    if (!existing) {
      const lineCount = await this.prisma.cartItem.count({ where: { userId } });
      if (lineCount >= CART_MAX_LINES) {
        throw new BadRequestException({
          code: 'CART_LINE_LIMIT',
          message: `Giỏ hàng tối đa ${CART_MAX_LINES} dòng sản phẩm`,
        });
      }
    }

    // Không kèm include để Prisma chạy upsert bằng INSERT ... ON CONFLICT: hai thiết
    // bị cùng thêm một món không tạo dòng trùng và không mất lượt cộng.
    const item = await this.prisma.cartItem.upsert({
      where,
      create: { userId, ...line, quantity: dto.quantity },
      update: { quantity: { increment: dto.quantity } },
    });
    if (item.quantity > CART_MAX_QUANTITY) {
      await this.prisma.cartItem.update({
        where: { id: item.id },
        data: { quantity: CART_MAX_QUANTITY },
      });
    }

    return this.afterChange(userId);
  }

  async updateQuantity(userId: string, id: string, quantity: number) {
    const result = await this.prisma.cartItem.updateMany({
      where: { id, userId },
      data: { quantity },
    });
    if (result.count === 0) {
      throw new NotFoundException('Không tìm thấy sản phẩm trong giỏ hàng');
    }
    return this.afterChange(userId);
  }

  async removeItem(userId: string, id: string) {
    const result = await this.prisma.cartItem.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      throw new NotFoundException('Không tìm thấy sản phẩm trong giỏ hàng');
    }
    return this.afterChange(userId);
  }

  async clear(userId: string) {
    await this.prisma.cartItem.deleteMany({ where: { userId } });
    return this.afterChange(userId);
  }

  /**
   * Gộp giỏ khách (lưu trên thiết bị) vào giỏ server khi đăng nhập. Món trùng lấy
   * số lượng lớn hơn chứ không cộng, nên gửi lại cùng request không làm nhân đôi.
   * Món ngừng bán, sai màu hoặc vượt số dòng thì bỏ qua và trả về trong `skipped`.
   */
  async merge(userId: string, dto: MergeCartDto) {
    const productIds = [...new Set(dto.items.map((item) => item.productId))];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds }, status: ProductStatus.ACTIVE },
          select: { id: true, colors: true },
        })
      : [];
    const productMap = new Map(products.map((product) => [product.id, product]));

    const skipped: Array<CartLineKey & { reason: MergeSkipReason }> = [];
    const incoming = new Map<string, CartLine>();
    for (const item of dto.items) {
      const line = this.toLineKey(item);
      const product = productMap.get(line.productId);
      if (!product) {
        skipped.push({ ...line, reason: 'PRODUCT_UNAVAILABLE' });
        continue;
      }
      const color = line.color ? resolveProductColor(product.colors, line.color) : '';
      if (color === null) {
        skipped.push({ ...line, reason: 'INVALID_COLOR' });
        continue;
      }
      const canonical = { ...line, color };
      const id = this.lineId(canonical);
      const quantity = Math.max(incoming.get(id)?.quantity ?? 0, item.quantity);
      incoming.set(id, { ...canonical, quantity });
    }
    // Ghi theo thứ tự cố định để hai transaction cùng user (merge, dọn giỏ sau thanh
    // toán) khoá các dòng cùng một thứ tự, không deadlock.
    const purchasable = this.sortLines([...incoming.values()]);

    if (purchasable.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.cartItem.findMany({
          where: { userId },
          select: { productId: true, color: true, comboType: true },
        });
        const existingIds = new Set(existing.map((item) => this.lineId(item)));
        let freeLines = CART_MAX_LINES - existing.length;
        const accepted = purchasable.filter((line) => {
          if (existingIds.has(this.lineId(line))) return true;
          if (freeLines > 0) {
            freeLines -= 1;
            return true;
          }
          skipped.push({ ...this.pickKey(line), reason: 'CART_LINE_LIMIT' });
          return false;
        });

        // Dòng chưa có thì tạo; dòng đã có (kể cả do thiết bị khác vừa tạo) bị bỏ
        // qua ở đây rồi được nâng lên số lượng lớn hơn ở vòng dưới.
        await tx.cartItem.createMany({
          data: accepted.map((line) => ({ userId, ...line })),
          skipDuplicates: true,
        });
        for (const line of accepted) {
          await tx.cartItem.updateMany({
            where: { userId, ...this.pickKey(line), quantity: { lt: line.quantity } },
            data: { quantity: line.quantity },
          });
        }
      });
    }

    const cart = purchasable.length > 0 ? await this.afterChange(userId) : await this.getCart(userId);
    return {
      ...cart,
      skipped: skipped.map((line) => ({
        productId: line.productId,
        color: line.color || null,
        comboType: line.comboType || null,
        reason: line.reason,
      })),
    };
  }

  /**
   * Trừ các món vừa thanh toán khỏi giỏ, gọi sau khi đơn chuyển PAID. Trừ đúng số
   * lượng đã mua chứ không xoá cả dòng: nếu user vừa tăng thêm ở thiết bị khác thì
   * phần dư vẫn còn. Trả về true khi giỏ có thay đổi.
   */
  async removePurchasedItems(userId: string, items: PurchasedItem[]) {
    if (items.length === 0) return false;

    const lines = this.sortLines(
      items.map((item) => ({
        productId: item.productId,
        color: item.color?.trim() ?? '',
        comboType: item.comboType ?? '',
        quantity: item.quantity,
      })),
    );

    const changed = await this.prisma.$transaction(async (tx) => {
      let matched = 0;
      for (const line of lines) {
        const result = await tx.cartItem.updateMany({
          where: {
            userId,
            productId: line.productId,
            // Giỏ lưu tên màu chuẩn của sản phẩm; so không phân biệt hoa thường để đơn
            // gửi "black" vẫn trừ đúng dòng "Black".
            color: { equals: line.color, mode: 'insensitive' },
            comboType: line.comboType,
          },
          data: { quantity: { decrement: line.quantity } },
        });
        matched += result.count;
      }
      if (matched > 0) {
        await tx.cartItem.deleteMany({ where: { userId, quantity: { lte: 0 } } });
      }
      return matched > 0;
    });

    if (changed) this.notifyUpdated(userId);
    return changed;
  }

  // Kiểm tra sản phẩm còn bán và màu hợp lệ; trả về dòng với tên màu chuẩn của sản phẩm
  // để "black" và "Black" không thành hai dòng khác nhau.
  private async resolvePurchasableLine(line: CartLineKey): Promise<CartLineKey> {
    const product = await this.prisma.product.findUnique({
      where: { id: line.productId },
      select: { id: true, name: true, status: true, colors: true },
    });
    if (!product) {
      throw new NotFoundException(`Không tìm thấy sản phẩm có ID: ${line.productId}`);
    }
    if (product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException({
        code: 'PRODUCT_UNAVAILABLE',
        message: `Sản phẩm "${product.name}" hiện không còn bán`,
      });
    }
    if (!line.color) return line;
    const color = resolveProductColor(product.colors, line.color);
    if (color === null) {
      throw new BadRequestException(`Màu "${line.color}" không hợp lệ cho sản phẩm "${product.name}"`);
    }
    return { ...line, color };
  }

  private async afterChange(userId: string) {
    this.notifyUpdated(userId);
    return this.getCart(userId);
  }

  // Báo các thiết bị khác của user tải lại giỏ. Lỗi realtime không được làm fail request.
  private notifyUpdated(userId: string) {
    try {
      this.realtimeEmitter.toUser(userId, CART_UPDATED_EVENT, { updatedAt: new Date().toISOString() });
    } catch (err) {
      this.logger.warn(`Không emit được ${CART_UPDATED_EVENT} cho user ${userId}: ${(err as Error)?.message}`);
    }
  }

  private toLineKey(item: { productId: string; color?: string; comboType?: ComboType }): CartLineKey {
    return {
      productId: item.productId,
      color: item.color?.trim() ?? '',
      comboType: item.comboType ?? '',
    };
  }

  private pickKey(line: CartLineKey): CartLineKey {
    return { productId: line.productId, color: line.color, comboType: line.comboType };
  }

  private lineId(line: CartLineKey) {
    return `${line.productId}\u0000${line.color}\u0000${line.comboType}`;
  }

  private sortLines<T extends CartLineKey>(lines: T[]): T[] {
    return [...lines].sort((a, b) => (this.lineId(a) < this.lineId(b) ? -1 : this.lineId(a) > this.lineId(b) ? 1 : 0));
  }

  // Giá trả về chỉ để hiển thị; quote/đặt hàng vẫn tự tính lại từ DB.
  private toCartResponse(items: CartItemWithProduct[]) {
    const lines = items.map((item) => {
      const { product } = item;
      return {
        id: item.id,
        productId: item.productId,
        color: item.color || null,
        comboType: (item.comboType || null) as ComboType | null,
        quantity: item.quantity,
        available: product.status === ProductStatus.ACTIVE,
        product: {
          id: product.id,
          name: product.name,
          price: Number(product.price),
          originalPrice: product.originalPrice === null ? null : Number(product.originalPrice),
          status: product.status,
          category: product.category,
          garmentType: product.garmentType,
          colors: product.colors,
          imageUrl: resolveGarmentUrlForColor(product.images, product.garmentUrl, item.color || null),
        },
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });

    return {
      items: lines,
      totalItems: lines.reduce((sum, line) => sum + line.quantity, 0),
    };
  }
}
