import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { QueryReviewDto } from './dto/query-review.dto';
import { CreateReviewReplyDto } from './dto/create-review-reply.dto';
import { UpdateReviewReplyDto } from './dto/update-review-reply.dto';
import { QueryReviewReplyDto } from './dto/query-review-reply.dto';
import { Prisma, OrderStatus, Role, NotificationType } from '@prisma/client';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async create(userId: string, productId: string, dto: CreateReviewDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException('Sản phẩm không tồn tại');
    }

    const deliveredOrder = await this.prisma.order.findFirst({
      where: {
        userId,
        status: OrderStatus.DELIVERED,
        items: { some: { productId } },
      },
      select: { id: true },
    });

    if (!deliveredOrder) {
      throw new BadRequestException('Bạn chỉ có thể đánh giá sản phẩm đã mua và đã nhận hàng');
    }

    const existingReview = await this.prisma.review.findUnique({
      where: {
        userId_productId_orderId: {
          userId,
          productId,
          orderId: deliveredOrder.id,
        },
      },
    });

    if (existingReview) {
      throw new BadRequestException('Bạn đã đánh giá sản phẩm này trong đơn hàng này');
    }

    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          userId,
          productId,
          orderId: deliveredOrder.id,
          rating: dto.rating,
          comment: dto.comment,
          images: dto.images ? JSON.parse(JSON.stringify(dto.images)) : undefined,
        },
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } },
        },
      });

      await this.updateProductRating(tx, productId);

      // Notify admins about new review (fire-and-forget, don't block response)
      this.notifyAdminsNewReview(review, product.name).catch(() => undefined);

      return review;
    });
  }

  private async notifyAdminsNewReview(review: { id: string; productId: string; user: { name: string | null } }, productName: string) {
    const admins = await this.prisma.user.findMany({
      where: { role: Role.ADMIN },
      select: { id: true },
    });

    const reviewerName = review.user.name ?? 'Người dùng';
    for (const admin of admins) {
      await this.notificationService.create({
        userId: admin.id,
        type: NotificationType.REVIEW,
        title: 'Đánh giá mới',
        message: `${reviewerName} vừa đánh giá ${productName}`,
        data: { reviewId: review.id, productId: review.productId, type: 'NEW_REVIEW' },
      });
    }
  }

  async findByProduct(productId: string, query: QueryReviewDto, userId?: string) {
    const { page = 1, limit = 10, rating } = query;

    const where: Prisma.ReviewWhereInput = {
      productId,
      ...(rating ? { rating } : {}),
    };

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } },
          replies: {
            orderBy: { createdAt: 'asc' },
            include: {
              user: { select: { id: true, name: true, avatarUrl: true, role: true } },
            },
          },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    const stats = await this.getProductStats(productId);

    // Auto-mark notifications as read for this user
    if (userId && items.length > 0) {
      const reviewIds = items.map((r) => r.id);
      await this.markReviewNotificationsRead(userId, reviewIds).catch(() => undefined);
    }

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        ...stats,
      },
    };
  }

  async findByUser(userId: string, query: QueryReviewDto) {
    const { page = 1, limit = 10, rating } = query;

    const where: Prisma.ReviewWhereInput = {
      userId,
      ...(rating ? { rating } : {}),
    };

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { id: true, name: true, garmentUrl: true } },
        },
      }),
      this.prisma.review.count({ where }),
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

  async getProductStats(productId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { productId },
      select: { rating: true },
    });

    const total = reviews.length;
    const avgRating = total > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / total
      : 0;

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reviews) {
      distribution[r.rating as keyof typeof distribution]++;
    }

    return {
      avgRating: Math.round(avgRating * 10) / 10,
      reviewCount: total,
      distribution,
    };
  }

  private async updateProductRating(tx: Prisma.TransactionClient, productId: string) {
    const stats = await this.getProductStats(productId);

    await tx.product.update({
      where: { id: productId },
      data: {
        avgRating: stats.avgRating,
        reviewCount: stats.reviewCount,
      },
    });
  }

  async update(userId: string, reviewId: string, dto: UpdateReviewDto) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      throw new NotFoundException('Không tìm thấy đánh giá');
    }

    if (review.userId !== userId) {
      throw new BadRequestException('Bạn không có quyền sửa đánh giá này');
    }

    return this.prisma.review.update({
      where: { id: reviewId },
      data: {
        comment: dto.comment ?? review.comment,
        images: dto.images ? JSON.parse(JSON.stringify(dto.images)) : review.images,
      },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  async remove(userId: string, reviewId: string, isAdmin = false) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      throw new NotFoundException('Không tìm thấy đánh giá');
    }

    if (!isAdmin && review.userId !== userId) {
      throw new BadRequestException('Bạn không có quyền xóa đánh giá này');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.review.delete({ where: { id: reviewId } });
      await this.updateProductRating(tx, review.productId);
    });

    return { message: 'Xóa đánh giá thành công' };
  }

  // --- Review Reply Methods ---

  async createReply(userId: string, reviewId: string, dto: CreateReviewReplyDto) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: { user: { select: { id: true, name: true } } },
    });

    if (!review) {
      throw new NotFoundException('Không tìm thấy đánh giá');
    }

    const reply = await this.prisma.reviewReply.create({
      data: {
        reviewId,
        userId,
        content: dto.content,
      },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true, role: true } },
      },
    });

    // Notify review owner (if not self-reply)
    if (review.userId !== userId) {
      const isAdmin = reply.user.role === Role.ADMIN;
      await this.notificationService.create({
        userId: review.userId,
        type: NotificationType.REVIEW,
        title: isAdmin ? 'Phản hồi từ shop' : 'Phản hồi mới',
        message: `${reply.user.name} đã phản hồi đánh giá của bạn`,
        data: { reviewId, replyId: reply.id, type: 'REVIEW_REPLY' },
      });
    }

    return reply;
  }

  async findReplies(reviewId: string, query: QueryReviewReplyDto) {
    const { page = 1, limit = 20 } = query;

    const where: Prisma.ReviewReplyWhereInput = { reviewId };
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.reviewReply.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
        include: {
          user: { select: { id: true, name: true, avatarUrl: true, role: true } },
        },
      }),
      this.prisma.reviewReply.count({ where }),
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

  async updateReply(userId: string, replyId: string, dto: UpdateReviewReplyDto) {
    const reply = await this.prisma.reviewReply.findUnique({
      where: { id: replyId },
    });

    if (!reply) {
      throw new NotFoundException('Không tìm thấy phản hồi');
    }

    if (reply.userId !== userId) {
      throw new BadRequestException('Bạn không có quyền sửa phản hồi này');
    }

    return this.prisma.reviewReply.update({
      where: { id: replyId },
      data: {
        content: dto.content ?? reply.content,
      },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true, role: true } },
      },
    });
  }

  async removeReply(userId: string, replyId: string, isAdmin = false) {
    const reply = await this.prisma.reviewReply.findUnique({
      where: { id: replyId },
    });

    if (!reply) {
      throw new NotFoundException('Không tìm thấy phản hồi');
    }

    if (!isAdmin && reply.userId !== userId) {
      throw new BadRequestException('Bạn không có quyền xóa phản hồi này');
    }

    await this.prisma.reviewReply.delete({ where: { id: replyId } });

    return { message: 'Xóa phản hồi thành công' };
  }

  private async markReviewNotificationsRead(userId: string, reviewIds: string[]) {
    await this.notificationService.markReviewNotificationsRead(userId, reviewIds);
  }
}