import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeEmitter } from '../realtime/realtime.emitter';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Prisma.InputJsonValue;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: RealtimeEmitter,
  ) {}

  /**
   * Ghi DB TRƯỚC rồi mới emit. Bản ghi DB là thứ user thấy khi mở app (kể cả lúc
   * offline); emit chỉ là kênh realtime phụ. Không bao giờ emit mà không ghi.
   */
  async create(input: CreateNotificationInput) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        data: input.data,
      },
    });

    this.emitter.toUser(input.userId, 'notification', notification);
    return notification;
  }

  async list(userId: string, page = 1, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;

    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      items,
      meta: { total, unread, page, limit: take, totalPages: Math.ceil(total / take) },
    };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { unread: count };
  }

  async markRead(userId: string, id: string) {
    // updateMany + điều kiện userId: vừa chặn đọc/sửa notification của người khác,
    // vừa trả count=0 (thay vì ném) khi id không thuộc user để controller báo 404.
    const result = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
    if (result.count === 0) {
      throw new NotFoundException('Không tìm thấy thông báo');
    }
    return { id, isRead: true };
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { updated: result.count };
  }

  async markReviewNotificationsRead(userId: string, reviewIds: string[]) {
    if (!reviewIds.length) return { updated: 0 };
    // Prisma JSON filter doesn't support 'in' directly, so we fetch and filter
    const notifications = await this.prisma.notification.findMany({
      where: {
        userId,
        type: NotificationType.REVIEW,
        isRead: false,
      },
      select: { id: true, data: true },
    });

    const targetIds = new Set(reviewIds);
    const toUpdate = notifications.filter((n) => {
      const reviewId = (n.data as Record<string, unknown>)?.reviewId;
      return typeof reviewId === 'string' && targetIds.has(reviewId);
    });

    if (!toUpdate.length) return { updated: 0 };

    const result = await this.prisma.notification.updateMany({
      where: { id: { in: toUpdate.map((n) => n.id) } },
      data: { isRead: true },
    });
    return { updated: result.count };
  }
}
