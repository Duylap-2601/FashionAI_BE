import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, OrderChatSenderRole, OrderStatus, Prisma, RefundStatus, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { FileValidationPipe } from '../../common/pipes/file-validation.pipe';
import { RedisService } from '../../common/services/redis.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { NotificationService } from '../notification/notification.service';
import { RealtimeEmitter } from '../realtime/realtime.emitter';
import { StorageService } from '../storage/storage.service';
import { MarkOrderChatReadDto, SendOrderChatMessageDto } from './dto/order-chat.dto';

type ChatActor = Pick<AuthenticatedUser, 'id' | 'role' | 'name' | 'avatarUrl'>;

const MAX_MESSAGE_LENGTH = 2000;
const MAX_ATTACHMENTS = 3;
const MAX_MESSAGES_PER_MINUTE = 30;
const DEFAULT_PAGE_SIZE = 20;

// Đơn đã đóng thì không hiện trong switcher của bong bóng chat; lịch sử vẫn
// xem được trong trang chi tiết đơn (GET /orders/:id/chat không lọc trạng thái).
// Đơn đã đóng thì không hiện trong switcher của bong bóng chat; lịch sử vẫn
// xem được trong trang chi tiết đơn (GET /orders/:id/chat không lọc trạng thái).
const CLOSED_CHAT_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
  OrderStatus.RETURNED,
  OrderStatus.EXPIRED,
  OrderStatus.FAILED,
];

// Khoá gửi tin khi đơn đã huỷ/hoàn trả VÀ tiền đã hoàn xong. Đơn COMPLETED vẫn
// mở chat để hỗ trợ hậu mãi; lịch sử cũ luôn xem được.
const CHAT_LOCKED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.RETURNED,
];

@Injectable()
export class OrderChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly storageService: StorageService,
    private readonly redisService: RedisService,
    private readonly emitter: RealtimeEmitter,
  ) {}

  async getThread(actor: ChatActor, orderId: string, before?: string, limit?: number) {
    const order = await this.resolveOrderForChat(actor, orderId);
    const conversation = await this.prisma.orderConversation.findUnique({
      where: { orderId: order.id },
      select: { id: true, customerUnreadCount: true, adminUnreadCount: true },
    });
    if (!conversation) {
      return {
        messages: [],
        nextCursor: null as string | null,
        hasMore: false,
        unreadForCustomer: 0,
        unreadForAdmin: 0,
        locked: this.isChatLocked(order),
      };
    }

    const requestedLimit = Number(limit);
    const take = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 50)
      : DEFAULT_PAGE_SIZE;
    let cursorId: string | undefined;
    if (before) {
      const exists = await this.prisma.orderChatMessage.findFirst({
        where: { id: before, conversationId: conversation.id },
        select: { id: true },
      });
      cursorId = exists?.id;
    }
    const rows = await this.prisma.orderChatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].id : null;

    return {
      messages: page.slice().reverse().map((message) => this.toMessageView(message)),
      nextCursor,
      hasMore,
      unreadForCustomer: conversation.customerUnreadCount,
      unreadForAdmin: conversation.adminUnreadCount,
      locked: this.isChatLocked(order),
    };
  }

  async listMyThreads(userId: string) {
    const [conversations, orders] = await Promise.all([
      this.prisma.orderConversation.findMany({
        where: {
          customerId: userId,
          order: { status: { notIn: CLOSED_CHAT_ORDER_STATUSES } },
        },
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        take: 50,
        select: {
          orderId: true,
          lastMessageAt: true,
          lastMessagePreview: true,
          customerUnreadCount: true,
          order: { select: { orderCode: true, status: true } },
        },
      }),
      this.prisma.order.findMany({
        where: {
          userId,
          targetTier: null,
          status: { notIn: CLOSED_CHAT_ORDER_STATUSES },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, orderCode: true, status: true, createdAt: true },
      }),
    ]);

    return {
      threads: conversations.map((conversation) => ({
        orderId: conversation.orderId,
        orderCode: conversation.order.orderCode,
        orderStatus: conversation.order.status,
        lastMessageAt: conversation.lastMessageAt,
        lastMessagePreview: conversation.lastMessagePreview,
        unread: conversation.customerUnreadCount,
      })),
      orders: orders.map((order) => ({
        orderId: order.id,
        orderCode: order.orderCode,
        status: order.status,
      })),
    };
  }

  async sendMessage(
    actor: ChatActor,
    orderId: string,
    dto: SendOrderChatMessageDto,
    files: Express.Multer.File[] = [],
  ) {
    const order = await this.resolveOrderForChat(actor, orderId);
    if (this.isChatLocked(order)) {
      throw new BadRequestException('Hội thoại đã đóng vì đơn đã huỷ/hoàn trả và hoàn tiền xong.');
    }
    const content = (dto.content ?? '').trim();
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(`Tin nhắn tối đa ${MAX_MESSAGE_LENGTH} ký tự.`);
    }
    if (files.length > MAX_ATTACHMENTS) {
      throw new BadRequestException(`Chỉ được gửi tối đa ${MAX_ATTACHMENTS} ảnh mỗi tin nhắn.`);
    }
    if (!content && files.length === 0) {
      throw new BadRequestException('Tin nhắn cần có nội dung hoặc ảnh.');
    }

    const rateKey = `rate:order-chat:send:${order.id}`;
    const sentInWindow = await this.redisService.incr(rateKey, 60);
    if (sentInWindow > MAX_MESSAGES_PER_MINUTE) {
      throw new HttpException('Bạn gửi tin nhắn quá nhanh, vui lòng thử lại sau.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const attachments: string[] = [];
    if (files.length > 0) {
      const filePipe = new FileValidationPipe({ maxSize: 10 * 1024 * 1024 });
      for (const file of files) {
        filePipe.transform(file);
        attachments.push(await this.storageService.uploadImage(file.buffer, 'order-chat'));
      }
    }

    const senderRole = actor.role === Role.ADMIN
      ? OrderChatSenderRole.ADMIN
      : OrderChatSenderRole.CUSTOMER;
    const clientMessageId = dto.clientMessageId?.trim() || null;

    const result = await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.orderConversation.upsert({
        where: { orderId: order.id },
        create: { orderId: order.id, customerId: order.userId },
        update: {},
        select: { id: true, customerUnreadCount: true, adminUnreadCount: true },
      });

      if (clientMessageId) {
        const existing = await tx.orderChatMessage.findFirst({
          where: { conversationId: conversation.id, clientMessageId },
        });
        if (existing) {
          return {
            message: existing,
            duplicated: true,
            unreadAfter: null,
            customerUnread: conversation.customerUnreadCount,
            adminUnread: conversation.adminUnreadCount,
          };
        }
      }

      const created = await tx.orderChatMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: actor.id,
          senderRole,
          senderNameSnapshot: actor.name ?? null,
          senderAvatarSnapshot: actor.avatarUrl ?? null,
          content: content || null,
          attachments: attachments.length > 0 ? (attachments as Prisma.InputJsonValue) : undefined,
          clientMessageId,
        },
      });

      const isCustomer = senderRole === OrderChatSenderRole.CUSTOMER;
      const updated = await tx.orderConversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: created.createdAt,
          lastMessagePreview: content ? content.slice(0, 120) : '[Ảnh]',
          ...(isCustomer
            ? { adminUnreadCount: { increment: 1 } }
            : { customerUnreadCount: { increment: 1 } }),
        },
        select: {
          customerUnreadCount: true,
          adminUnreadCount: true,
        },
      });

      return {
        message: created,
        duplicated: false,
        unreadAfter: isCustomer ? updated.adminUnreadCount : updated.customerUnreadCount,
        customerUnread: updated.customerUnreadCount,
        adminUnread: updated.adminUnreadCount,
      };
    });

    const payload = {
      orderId: order.id,
      orderCode: order.orderCode,
      message: this.toMessageView(result.message),
    };

    this.emitter.toUser(order.userId, 'order_chat:message', payload);
    this.emitter.toAdmins('order_chat:message', payload);

    if (!result.duplicated && result.unreadAfter === 1) {
      if (senderRole === OrderChatSenderRole.CUSTOMER) {
        this.notifyAdmins(order, result.message).catch(() => undefined);
      } else {
        this.notifyCustomer(order, result.message).catch(() => undefined);
      }
    }

    return {
      message: this.toMessageView(result.message),
      unreadForCustomer: result.customerUnread,
      unreadForAdmin: result.adminUnread,
    };
  }

  async markRead(actor: ChatActor, orderId: string, dto: MarkOrderChatReadDto = {}) {
    const order = await this.resolveOrderForChat(actor, orderId);
    const conversation = await this.prisma.orderConversation.findUnique({
      where: { orderId: order.id },
      select: { id: true },
    });
    if (!conversation) {
      return { updated: 0, unreadForCustomer: 0, unreadForAdmin: 0 };
    }

    const isAdmin = actor.role === Role.ADMIN;
    const oppositeRole = isAdmin ? OrderChatSenderRole.CUSTOMER : OrderChatSenderRole.ADMIN;

    let cutoff = new Date();
    if (dto.upToMessageId) {
      const upTo = await this.prisma.orderChatMessage.findFirst({
        where: { id: dto.upToMessageId, conversationId: conversation.id },
        select: { createdAt: true },
      });
      if (upTo) cutoff = upTo.createdAt;
    }

    const unreadWhere: Prisma.OrderChatMessageWhereInput = {
      conversationId: conversation.id,
      senderRole: oppositeRole,
      createdAt: { lte: cutoff },
      ...(isAdmin ? { readByAdminAt: null } : { readByCustomerAt: null }),
    };
    const unreadCount = await this.prisma.orderChatMessage.count({ where: unreadWhere });
    if (unreadCount > 0) {
      await this.prisma.orderChatMessage.updateMany({
        where: unreadWhere,
        data: isAdmin ? { readByAdminAt: new Date() } : { readByCustomerAt: new Date() },
      });
      if (isAdmin) {
        await this.prisma.$executeRaw`
          UPDATE order_conversations
          SET admin_unread_count = GREATEST(admin_unread_count - ${unreadCount}, 0)
          WHERE id = ${conversation.id}::uuid
        `;
      } else {
        await this.prisma.$executeRaw`
          UPDATE order_conversations
          SET customer_unread_count = GREATEST(customer_unread_count - ${unreadCount}, 0)
          WHERE id = ${conversation.id}::uuid
        `;
      }
    }

    const readPayload = { orderId: order.id, messageId: dto.upToMessageId ?? null };
    if (unreadCount > 0) {
      if (isAdmin) this.emitter.toUser(order.userId, 'order_chat:read', readPayload);
      else this.emitter.toAdmins('order_chat:read', readPayload);
    }

    const updated = await this.prisma.orderConversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: { customerUnreadCount: true, adminUnreadCount: true },
    });
    return {
      updated: unreadCount,
      unreadForCustomer: updated.customerUnreadCount,
      unreadForAdmin: updated.adminUnreadCount,
    };
  }

  private async resolveOrderForChat(actor: ChatActor, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        orderCode: true,
        userId: true,
        status: true,
        refundStatus: true,
        refundConfirmedAt: true,
      },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng');
    if (actor.role !== Role.ADMIN && order.userId !== actor.id) {
      throw new NotFoundException('Không tìm thấy đơn hàng');
    }
    return order;
  }

  private isChatLocked(order: {
    status: OrderStatus;
    refundStatus: RefundStatus | null;
    refundConfirmedAt: Date | null;
  }): boolean {
    return (
      CHAT_LOCKED_ORDER_STATUSES.includes(order.status) &&
      order.refundStatus === RefundStatus.COMPLETED &&
      Boolean(order.refundConfirmedAt)
    );
  }

  private toMessageView(message: {
    id: string;
    senderId: string | null;
    senderRole: OrderChatSenderRole;
    senderNameSnapshot: string | null;
    senderAvatarSnapshot: string | null;
    content: string | null;
    attachments: Prisma.JsonValue;
    clientMessageId: string | null;
    readByCustomerAt: Date | null;
    readByAdminAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: message.id,
      senderId: message.senderId,
      senderRole: message.senderRole,
      senderName: message.senderNameSnapshot,
      senderAvatarUrl: message.senderAvatarSnapshot,
      content: message.content ?? '',
      attachments: Array.isArray(message.attachments) ? (message.attachments as string[]) : [],
      clientMessageId: message.clientMessageId,
      readByCustomerAt: message.readByCustomerAt,
      readByAdminAt: message.readByAdminAt,
      createdAt: message.createdAt,
    };
  }

  private async notifyCustomer(
    order: { id: string; orderCode: number; userId: string },
    message: { content: string | null; attachments: Prisma.JsonValue },
  ) {
    await this.notificationService.create({
      userId: order.userId,
      type: NotificationType.ORDER_CHAT,
      title: `Shop nhắn về đơn #${order.orderCode}`,
      message: message.content?.slice(0, 160) || 'Shop vừa gửi một ảnh.',
      data: { orderId: order.id, orderCode: order.orderCode, type: 'ORDER_CHAT' },
    });
  }

  private async notifyAdmins(
    order: { id: string; orderCode: number },
    message: { content: string | null },
  ) {
    const admins = await this.prisma.user.findMany({
      where: { role: Role.ADMIN },
      select: { id: true },
    });
    await Promise.all(admins.map((admin) => this.notificationService.create({
      userId: admin.id,
      type: NotificationType.ORDER_CHAT,
      title: `Khách nhắn về đơn #${order.orderCode}`,
      message: message.content?.slice(0, 160) || 'Khách vừa gửi một ảnh.',
      data: { orderId: order.id, orderCode: order.orderCode, type: 'ORDER_CHAT' },
    }).catch(() => undefined)));
  }
}
