import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { UserTier, Prisma, PaymentStatus } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';
import {
  SUBSCRIPTION_DURATION_DAYS,
  RENEWAL_REMINDER_DAYS_BEFORE,
  PRORATION_QUOTE_MAX_AGE_MS,
  TIER_PRICES,
  isUpgrade,
  resolveEffectiveTier,
} from '../../common/constants/subscription-plans.constants';

/** Đơn gói thành viên đã thanh toán: đủ dữ liệu để cấp quyền và kiểm tra quote proration. */
export interface SubscriptionPurchaseOrder {
  id: string;
  orderCode?: number | null;
  amount: Prisma.Decimal | number | string;
  amountPaidVnd?: bigint | number | null;
  prorationSnapshot?: Prisma.JsonValue | null;
  createdAt?: Date | null;
}

/** Đơn đã được hoàn tiền toàn bộ — đầu vào của bước thu hồi quyền lợi. */
export interface RefundedSubscriptionOrder {
  id: string;
  userId: string;
  targetTier: UserTier | null;
  amount: Prisma.Decimal | number | string;
  amountPaidVnd?: bigint | number | null;
}

/** Kết quả thu hồi quyền lợi để bên gọi báo cho khách sau khi transaction commit. */
export interface RefundRevocationResult {
  userId: string;
  tier: UserTier;
  tierExpiresAt: Date | null;
  cancelledSubscriptionIds: string[];
}

/** Chạy được với cả PrismaService lẫn transaction client. */
type SubscriptionDb = PrismaService | Prisma.TransactionClient;

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Dòng ACTIVE duy nhất của user (partial unique index
   * `subscriptions_one_active_per_user` bảo đảm tính duy nhất). Mọi luồng ghi phải
   * resolve qua đây rồi update theo `id`, không dựng lại predicate.
   */
  private findActiveSubscription(userId: string, db: SubscriptionDb = this.prisma) {
    return db.subscription.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        expiresAt: { gte: new Date() },
      },
      orderBy: { expiresAt: 'desc' },
      include: {
        order: { select: { orderCode: true, amount: true } },
      },
    });
  }

  private addDays(from: Date, days: number): Date {
    const result = new Date(from);
    result.setDate(result.getDate() + days);
    return result;
  }

  /**
   * Số ngày được cấp khi quote proration không còn dùng được: quy đổi trực tiếp
   * từ số tiền khách đã trả. Trả đủ giá gói thì ra đúng 30 ngày.
   */
  private resolveGrantedDays(paidVnd: number, tier: UserTier): number {
    const planPrice = TIER_PRICES[tier];
    if (!Number.isFinite(paidVnd) || paidVnd <= 0 || !Number.isFinite(planPrice) || planPrice <= 0) {
      return 1;
    }
    const days = Math.round((paidVnd / planPrice) * SUBSCRIPTION_DURATION_DAYS);
    return Math.min(Math.max(days, 1), SUBSCRIPTION_DURATION_DAYS);
  }

  /** Quote proration đóng băng trên Order; null khi đơn không phải upgrade giữa kỳ. */
  private parseProrationQuote(
    snapshot: Prisma.JsonValue | null | undefined,
  ): { oldTier: UserTier; newTier: UserTier } | null {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return null;
    }
    const raw = snapshot as Record<string, unknown>;
    const oldTier = raw.oldTier as UserTier | undefined;
    const newTier = raw.newTier as UserTier | undefined;
    if (!oldTier || !newTier) return null;
    if (!(oldTier in TIER_PRICES) || !(newTier in TIER_PRICES)) return null;
    return { oldTier, newTier };
  }

  async getCurrentSubscription(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true, tierExpiresAt: true },
    });

    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const current = await this.findActiveSubscription(userId);

    const scheduled = await this.prisma.subscription.findFirst({
      where: { userId, status: 'SCHEDULED' },
      orderBy: { startsAt: 'asc' },
    });

    const effectiveTier = resolveEffectiveTier(user.tier, user.tierExpiresAt);
    const daysRemaining = current
      ? Math.ceil(
          (current.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        )
      : 0;

    return {
      tier: effectiveTier,
      tierExpiresAt: user.tierExpiresAt,
      current: current
        ? {
            id: current.id,
            tier: current.tier,
            status: current.status,
            autoRenew: current.autoRenew,
            startsAt: current.startsAt,
            expiresAt: current.expiresAt,
            daysRemaining: Math.max(0, daysRemaining),
            price: Number(current.order.amount),
            order: { orderCode: current.order.orderCode, amount: Number(current.order.amount) },
          }
        : null,
      scheduled: scheduled
        ? {
            id: scheduled.id,
            tier: scheduled.tier,
            startsAt: scheduled.startsAt,
            expiresAt: scheduled.expiresAt,
          }
        : null,
      isFree: effectiveTier === 'FREE',
    };
  }

  async getSubscriptionHistory(userId: string, page = 1, limit = 20) {
    limit = Math.min(Math.max(limit, 1), 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          order: {
            select: {
              orderCode: true,
              amount: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.subscription.count({ where: { userId } }),
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

  async cancelAutoRenew(userId: string) {
    const current = await this.findActiveSubscription(userId);

    if (!current) {
      throw new NotFoundException(
        'Bạn chưa có gói đăng ký nào đang hoạt động.',
      );
    }

    // Update theo đúng id vừa resolve, điều kiện autoRenew giữ nguyên để chặn
    // hai request đồng thời cùng tắt một gói.
    const result = await this.prisma.subscription.updateMany({
      where: { id: current.id, autoRenew: true },
      data: { autoRenew: false },
    });

    if (result.count === 0) {
      throw new BadRequestException(
        'Gói của bạn đã tắt tự động gia hạn.',
      );
    }

    this.notificationService
      .create({
        userId,
        type: 'SYSTEM',
        title: 'Đã tắt tự động gia hạn',
        message: `Bạn vẫn sử dụng gói ${current.tier} đến ${current.expiresAt.toLocaleDateString('vi-VN')}. Bật lại bất cứ lúc nào.`,
        data: {
          subscriptionId: current.id,
          expiresAt: current.expiresAt,
        },
      })
      .catch(() => undefined);

    return {
      id: current.id,
      tier: current.tier,
      autoRenew: false,
      expiresAt: current.expiresAt,
      accessUntil: current.expiresAt,
    };
  }

  async resumeAutoRenew(userId: string) {
    const current = await this.findActiveSubscription(userId);

    if (!current) {
      throw new NotFoundException(
        'Bạn chưa có gói đăng ký nào đang hoạt động.',
      );
    }

    const result = await this.prisma.subscription.updateMany({
      where: { id: current.id, autoRenew: false },
      data: { autoRenew: true },
    });

    if (result.count === 0) {
      throw new BadRequestException(
        'Gói của bạn đang bật tự động gia hạn.',
      );
    }

    this.notificationService
      .create({
        userId,
        type: 'SYSTEM',
        title: 'Đã bật tự động gia hạn',
        message: `Chúng tôi sẽ nhắc bạn gia hạn trước ${RENEWAL_REMINDER_DAYS_BEFORE} ngày.`,
        data: {
          subscriptionId: current.id,
        },
      })
      .catch(() => undefined);

    return {
      id: current.id,
      tier: current.tier,
      autoRenew: true,
      expiresAt: current.expiresAt,
    };
  }

  /**
   * Hủy lịch chuyển gói (SCHEDULED) do user đổi ý. Chỉ hủy chỗ giữ, không hoàn
   * tiền đơn downgrade đã thanh toán. Gói ACTIVE hiện tại được bật lại
   * auto-renew để quay về hành xử gia hạn bình thường.
   */
  async cancelScheduledSubscription(userId: string) {
    const scheduled = await this.prisma.subscription.findFirst({
      where: { userId, status: 'SCHEDULED' },
      orderBy: { startsAt: 'asc' },
    });

    if (!scheduled) {
      throw new NotFoundException(
        'Bạn không có lịch chuyển gói nào đang chờ.',
      );
    }

    const result = await this.prisma.subscription.updateMany({
      where: { id: scheduled.id, status: 'SCHEDULED' },
      data: { status: 'CANCELLED' },
    });

    if (result.count === 0) {
      throw new BadRequestException('Lịch chuyển gói đã được xử lý trước đó.');
    }

    const current = await this.findActiveSubscription(userId);

    if (current) {
      await this.prisma.subscription.update({
        where: { id: current.id },
        data: { autoRenew: true },
      });
    }

    this.notificationService
      .create({
        userId,
        type: 'SYSTEM',
        title: 'Đã hủy lịch chuyển gói',
        message: `Lịch chuyển sang gói ${scheduled.tier} đã được hủy. Bạn tiếp tục dùng gói hiện tại đến hết hạn. Số tiền đã thanh toán cho gói hẹn không được hoàn lại.`,
        data: {
          subscriptionId: scheduled.id,
          tier: scheduled.tier,
        },
      })
      .catch(() => undefined);

    return {
      id: scheduled.id,
      tier: scheduled.tier,
      status: 'CANCELLED',
      currentAutoRenew: true,
    };
  }

  async findSubscriptionsDueForRenewal(withinDays: number) {
    const now = new Date();
    const reminderDeadline = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

    return this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        autoRenew: true,
        renewalReminderSentAt: null,
        expiresAt: {
          gte: now,
          lte: reminderDeadline,
        },
        user: {
          subscriptions: {
            none: { status: 'SCHEDULED' },
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        order: {
          select: {
            orderCode: true,
            amount: true,
          },
        },
      },
      orderBy: { expiresAt: 'asc' },
    });
  }

  async markRenewalReminderSent(subscriptionId: string) {
    return this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { renewalReminderSentAt: new Date() },
    });
  }

  /**
   * Cấp quyền cho một đơn gói thành viên vừa thanh toán xong.
   *
   * Bất biến: mỗi user chỉ có tối đa MỘT dòng ACTIVE (partial unique index trong
   * migration `20261114000000_one_active_subscription_per_user`).
   * - NEW: tạo dòng ACTIVE mới.
   * - RENEWAL: cộng dồn vào dòng ACTIVE hiện tại (expiresAt + 30 ngày) và ghi
   *   thêm một dòng RENEWED mang `orderId` mới để lịch sử mua vẫn đủ.
   * - UPGRADE: dòng ACTIVE mới hiệu lực ngay, hết hạn theo chu kỳ đã trả tiền.
   * - DOWNGRADE: giữ chỗ bằng dòng SCHEDULED, kích hoạt khi gói hiện tại hết hạn.
   *
   * @param order Đơn đã thanh toán; `prorationSnapshot` + `createdAt` dùng để
   * kiểm tra lại quote proration lúc checkout còn đúng hay đã cũ.
   */
  async createOrExtendSubscription(
    userId: string,
    tier: UserTier,
    order: SubscriptionPurchaseOrder,
    tx?: Prisma.TransactionClient,
  ) {
    const db: SubscriptionDb = tx || this.prisma;
    const now = new Date();
    const orderId = order.id;

    // Chỉ dòng ACTIVE mới là quyền lợi đang chạy; dòng SCHEDULED (lịch hẹn đổi
    // gói) không được dùng làm mốc phân loại đơn đang thanh toán.
    const currentSub = await db.subscription.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { expiresAt: 'desc' },
    });

    let mode: 'NEW' | 'RENEWAL' | 'UPGRADE' | 'DOWNGRADE';

    // Phân loại đơn: NEW, RENEWAL (cùng gói), UPGRADE (lên gói), DOWNGRADE (xuống gói).
    if (!currentSub || currentSub.expiresAt <= now) {
      mode = 'NEW';
    } else if (currentSub.tier === tier) {
      mode = 'RENEWAL';
    } else if (isUpgrade(currentSub.tier, tier)) {
      mode = 'UPGRADE';
    } else {
      mode = 'DOWNGRADE';
    }

    if (mode === 'NEW') {
      // Dòng ACTIVE cũ (đã hết hạn / cron chưa dọn) vẫn chiếm "suất" ACTIVE của
      // user trong partial unique index, nên phải đóng nó trước khi tạo dòng mới.
      if (currentSub) {
        await db.subscription.updateMany({
          where: { id: currentSub.id, status: 'ACTIVE' },
          data: {
            status: currentSub.autoRenew ? 'EXPIRED' : 'CANCELLED',
            autoRenew: false,
          },
        });
      }

      // Mua mới thay thế lịch hẹn đổi gói còn treo (nếu có): quyền lợi mới hiệu
      // lực ngay, lịch hẹn cũ không còn ý nghĩa.
      await db.subscription.updateMany({
        where: { userId, status: 'SCHEDULED' },
        data: { status: 'CANCELLED', autoRenew: false },
      });

      // Đơn có quote proration nghĩa là khách chỉ trả phần chênh lệch: cấp đúng
      // số ngày tương ứng số tiền đã thu thay vì tặng nguyên 30 ngày.
      const paidVnd = Number(order.amount);
      const hasProrationQuote = this.parseProrationQuote(order.prorationSnapshot) !== null;
      const grantedDays = hasProrationQuote
        ? this.resolveGrantedDays(paidVnd, tier)
        : SUBSCRIPTION_DURATION_DAYS;
      const expiresAt = this.addDays(now, grantedDays);

      const subscription = await db.subscription.create({
        data: {
          userId,
          tier,
          orderId,
          status: 'ACTIVE',
          autoRenew: true,
          startsAt: now,
          expiresAt,
        },
      });

      await db.user.update({
        where: { id: userId },
        data: { tier, tierExpiresAt: expiresAt },
      });

      this.logger.log(
        `Subscription new: user=${userId} tier=${tier} paidVnd=${paidVnd} grantedDays=${grantedDays} ` +
        `(proratedQuote=${hasProrationQuote}) expires=${expiresAt.toISOString()}`,
      );

      return { subscription, mode };
    } else if (mode === 'RENEWAL') {
      // Gia hạn: cộng dồn vào chính dòng ACTIVE thay vì tạo dòng ACTIVE thứ hai
      // (index chỉ cho một dòng/user). Dòng RENEWED giữ vết đơn mới, nhờ đó hoàn
      // tiền đơn này còn cắt lại được phần vừa cộng.
      let activeRow = currentSub!;
      let startsAt = activeRow.expiresAt;
      let expiresAt = this.addDays(startsAt, SUBSCRIPTION_DURATION_DAYS);

      // Điều kiện status: 'ACTIVE' giữ nguyên để hai webhook đồng thời không cộng
      // dồn hai lần vào cùng một dòng.
      let extended = await db.subscription.updateMany({
        where: { id: activeRow.id, status: 'ACTIVE' },
        data: { expiresAt, autoRenew: true },
      });

      if (extended.count === 0) {
        // Dòng ACTIVE vừa bị luồng khác đóng (cron hết hạn / refund). Tiền đã vào
        // thì vẫn phải cấp quyền: cộng dồn vào dòng ACTIVE hiện tại nếu có, không
        // thì mở chu kỳ mới.
        const replacement = await db.subscription.findFirst({
          where: { userId, status: 'ACTIVE' },
          orderBy: { expiresAt: 'desc' },
        });
        if (replacement) {
          activeRow = replacement;
          startsAt = new Date();
          expiresAt = this.addDays(startsAt, SUBSCRIPTION_DURATION_DAYS);
          extended = await db.subscription.updateMany({
            where: { id: activeRow.id, status: 'ACTIVE' },
            data: { expiresAt, autoRenew: true },
          });
        } else {
          startsAt = new Date();
          expiresAt = this.addDays(startsAt, SUBSCRIPTION_DURATION_DAYS);
        }
        this.logger.warn(
          `Dòng ACTIVE ${currentSub!.id} của user=${userId} đã đổi trạng thái khi gia hạn; ` +
          `xử lý lại trên ${activeRow.id}`,
        );
      }

      const subscription = await db.subscription.create({
        data: {
          userId,
          tier,
          orderId,
          status: extended.count === 1 ? 'RENEWED' : 'ACTIVE',
          autoRenew: true,
          startsAt,
          expiresAt,
        },
      });

      await db.user.update({
        where: { id: userId },
        data: { tier, tierExpiresAt: expiresAt },
      });

      this.logger.log(
        `Subscription renewal (cộng dồn): user=${userId} tier=${tier} startsAt=${startsAt.toISOString()} expires=${expiresAt.toISOString()}`,
      );

      return { subscription, mode };
    } else if (mode === 'UPGRADE') {
      // Upgrade giữa kỳ: khách đã trả phần chênh lệch ở bước checkout, nên ngày
      // hết hạn phải bám theo quote proration đã đóng băng — nhưng chỉ khi quote
      // đó còn khớp thực tế. Quote cũ (gói hiện tại đã đổi / đã hết hạn / quá
      // 24h) thì cấp đúng số ngày tương ứng số tiền đã thu, không tặng 30 ngày.
      const quote = this.parseProrationQuote(order.prorationSnapshot);
      const quoteAgeMs = order.createdAt
        ? now.getTime() - new Date(order.createdAt).getTime()
        : Number.POSITIVE_INFINITY;
      const quoteStillApplies =
        quote !== null &&
        quote.newTier === tier &&
        quote.oldTier === currentSub!.tier &&
        currentSub!.expiresAt > now &&
        quoteAgeMs <= PRORATION_QUOTE_MAX_AGE_MS;

      let newExpiresAt: Date;
      if (quoteStillApplies) {
        newExpiresAt = new Date(currentSub!.expiresAt);
        this.logger.log(
          `Subscription UPGRADE (quote proration còn hiệu lực): user=${userId} from ${currentSub!.tier} to ${tier} ` +
          `effective=${now.toISOString()} expires=${newExpiresAt.toISOString()} quoteAgeMs=${quoteAgeMs}`,
        );
      } else {
        const grantedDays = this.resolveGrantedDays(Number(order.amount), tier);
        newExpiresAt = this.addDays(now, grantedDays);
        this.logger.log(
          `Subscription UPGRADE (quote proration cũ/không khớp): user=${userId} from ${currentSub!.tier} to ${tier} ` +
          `paidVnd=${Number(order.amount)} grantedDays=${grantedDays} effective=${now.toISOString()} expires=${newExpiresAt.toISOString()} quoteAgeMs=${quoteAgeMs}`,
        );
      }

      // Đóng dòng cũ nhưng GIỮ NGUYÊN expiresAt: nếu đơn upgrade này bị hoàn
      // tiền, phần thời gian còn lại của gói cũ (khách đã trả tiền, không liên
      // quan tới khoản hoàn) phải khôi phục được. Dòng CANCELLED còn hạn không
      // cấp quyền lợi ở bất kỳ truy vấn nào (mọi nơi đều lọc status 'ACTIVE').
      await db.subscription.updateMany({
        where: { id: currentSub!.id, status: 'ACTIVE' },
        data: {
          status: 'CANCELLED',
          autoRenew: false,
        },
      });

      const subscription = await db.subscription.create({
        data: {
          userId,
          tier,
          orderId,
          status: 'ACTIVE',
          autoRenew: true,
          startsAt: now,
          expiresAt: newExpiresAt,
        },
      });

      await db.user.update({
        where: { id: userId },
        data: { tier, tierExpiresAt: newExpiresAt },
      });

      const scheduledSub = await db.subscription.findFirst({
        where: { userId, status: 'SCHEDULED' },
      });
      if (scheduledSub) {
        await db.subscription.updateMany({
          where: { id: scheduledSub.id, status: 'SCHEDULED' },
          data: { status: 'CANCELLED' },
        });
      }

      return { subscription, mode };
    } else {
      // DOWNGRADE: giữ chỗ bằng dòng SCHEDULED bắt đầu đúng lúc gói hiện tại hết
      // hạn. Nếu user đang có sẵn một lịch hẹn thì lịch mới thay lịch cũ.
      const startsAt = currentSub!.expiresAt;
      const expiresAt = this.addDays(startsAt, SUBSCRIPTION_DURATION_DAYS);

      await db.subscription.updateMany({
        where: { userId, status: 'SCHEDULED' },
        data: { status: 'CANCELLED', autoRenew: false },
      });

      const subscription = await db.subscription.create({
        data: {
          userId,
          tier,
          orderId,
          status: 'SCHEDULED',
          autoRenew: true,
          startsAt,
          expiresAt,
        },
      });

      await db.subscription.updateMany({
        where: { id: currentSub!.id, status: 'ACTIVE' },
        data: { autoRenew: false },
      });

      this.logger.log(
        `Subscription DOWNGRADE SCHEDULED: user=${userId} from ${currentSub!.tier} to ${tier} effective=${startsAt.toISOString()}`,
      );

      return { subscription, mode };
    }
  }

  /**
   * Thu hồi quyền lợi khi đơn gói thành viên đã được hoàn TIỀN TOÀN BỘ.
   *
   * Gọi bên trong transaction chốt refund để trạng thái refund và quyền lợi
   * không bao giờ lệch nhau. Idempotent: lần thứ hai không còn dòng nào để hủy
   * nên trả về null (bên gọi cũng không báo trùng cho khách).
   *
   * @returns null khi không phải đơn gói, khi mới hoàn một phần, hoặc khi quyền
   * lợi đã bị thu hồi trước đó.
   */
  async revokeEntitlementForRefundedOrder(
    tx: Prisma.TransactionClient,
    order: RefundedSubscriptionOrder,
  ): Promise<RefundRevocationResult | null> {
    if (!order.targetTier) return null;

    const collectedVnd =
      Number(order.amountPaidVnd ?? 0) > 0
        ? Number(order.amountPaidVnd)
        : Math.round(Number(order.amount));
    const completed = await tx.refund.aggregate({
      where: { orderId: order.id, status: 'COMPLETED' },
      _sum: { amountVnd: true },
    });
    const refundedVnd = Number(completed._sum.amountVnd ?? BigInt(0));

    // Hoàn một phần: khách vẫn giữ quyền lợi tương ứng phần tiền chưa hoàn.
    if (collectedVnd <= 0 || refundedVnd < collectedVnd) return null;

    const rows = await tx.subscription.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });

    const cancelledSubscriptionIds: string[] = [];
    // Gia hạn bị hoàn tiền: quyền lợi cộng dồn nằm trên dòng ACTIVE của đơn cũ,
    // nên phải cắt lại đúng phần vừa cộng (expiresAt lùi về mốc startsAt của RENEWED).
    let renewedRow: { id: string; startsAt: Date; expiresAt: Date } | null = null;

    for (const row of rows) {
      if (row.status !== 'ACTIVE' && row.status !== 'SCHEDULED' && row.status !== 'RENEWED') {
        continue;
      }
      const updated = await tx.subscription.updateMany({
        where: { id: row.id, status: row.status },
        data: { status: 'CANCELLED', autoRenew: false },
      });
      if (updated.count === 0) continue;
      cancelledSubscriptionIds.push(row.id);
      if (row.status === 'RENEWED' && !renewedRow) {
        renewedRow = row;
      }
    }

    // Đã thu hồi ở lần chốt refund trước: không đụng lại state, không báo trùng.
    if (cancelledSubscriptionIds.length === 0) return null;

    const stillActive = await this.findActiveSubscription(order.userId, tx);
    let remaining = stillActive;

    // Chỉ lùi hạn khi dòng ACTIVE vẫn đang kết thúc đúng ở mốc mà lần gia hạn bị
    // hoàn đã cộng (nếu sau đó có gia hạn/nâng cấp khác thì không được cắt của họ).
    if (
      stillActive &&
      renewedRow &&
      stillActive.expiresAt.getTime() === renewedRow.expiresAt.getTime()
    ) {
      const rolledBackExpiresAt = renewedRow.startsAt;
      const rolledBackStillValid = rolledBackExpiresAt > new Date();
      await tx.subscription.updateMany({
        where: { id: stillActive.id, status: 'ACTIVE' },
        data: rolledBackStillValid
          ? { expiresAt: rolledBackExpiresAt }
          : { expiresAt: rolledBackExpiresAt, status: 'CANCELLED', autoRenew: false },
      });
      if (rolledBackStillValid) {
        remaining = { ...stillActive, expiresAt: rolledBackExpiresAt };
      } else {
        cancelledSubscriptionIds.push(stillActive.id);
        remaining = null;
      }
    }

    // Tính lại quyền lợi từ những gì còn thật sự hiệu lực.
    let tier = remaining ? remaining.tier : UserTier.FREE;
    let tierExpiresAt = remaining ? remaining.expiresAt : null;

    // Hoàn đơn UPGRADE: gói cũ đã bị đóng lúc nâng cấp nhưng thời gian còn lại
    // của nó là tiền khách đã trả cho một đơn KHÁC, không nằm trong khoản hoàn
    // này — phải trả lại. Tìm dòng bị đóng gần nhất mà vẫn còn hạn.
    if (!remaining) {
      const restorable = await tx.subscription.findFirst({
        where: {
          userId: order.userId,
          status: 'CANCELLED',
          expiresAt: { gt: new Date() },
          orderId: { not: order.id },
          id: { notIn: cancelledSubscriptionIds },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (restorable) {
        const restored = await tx.subscription.updateMany({
          where: { id: restorable.id, status: 'CANCELLED' },
          data: { status: 'ACTIVE', autoRenew: true },
        });
        if (restored.count === 1) {
          tier = restorable.tier;
          tierExpiresAt = restorable.expiresAt;
          this.logger.log(
            `Khôi phục gói ${restorable.tier} còn hạn đến ${restorable.expiresAt.toISOString()} ` +
            `sau khi hoàn đơn nâng cấp ${order.id} của user=${order.userId}`,
          );
        }
      }
    }

    await tx.user.update({
      where: { id: order.userId },
      data: { tier, tierExpiresAt },
    });

    this.logger.log(
      `Subscription thu hồi do hoàn tiền toàn bộ: user=${order.userId} orderId=${order.id} ` +
      `refundedVnd=${refundedVnd} cancelled=${cancelledSubscriptionIds.length} tier=${tier}`,
    );

    return {
      userId: order.userId,
      tier,
      tierExpiresAt,
      cancelledSubscriptionIds,
    };
  }

  async expireSubscriptions() {
    const now = new Date();

    // Step A (phần 1): đóng các dòng ACTIVE đã quá hạn TRƯỚC khi kích hoạt lịch
    // hẹn — partial unique index chỉ cho một dòng ACTIVE/user, và dòng bị lịch hẹn
    // thay thế luôn có expiresAt <= startsAt của lịch hẹn <= now.
    const cancelledResult = await this.prisma.subscription.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now }, autoRenew: false },
      data: { status: 'CANCELLED' },
    });

    const expiredResult = await this.prisma.subscription.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now }, autoRenew: true },
      data: { status: 'EXPIRED' },
    });

    // Step A (phần 2): kích hoạt các dòng SCHEDULED đã tới ngày, dùng đúng
    // expiresAt đã chốt lúc đặt lịch (không cộng lại 30 ngày) và chỉ khi đơn gốc
    // đã thanh toán.
    const scheduledSubs = await this.prisma.subscription.findMany({
      where: { status: 'SCHEDULED', startsAt: { lte: now } },
      include: {
        user: { select: { id: true } },
        order: { select: { orderCode: true, paymentStatus: true } },
      },
    });

    let activatedCount = 0;
    let skippedUnpaidCount = 0;
    for (const sub of scheduledSubs) {
      if (sub.order?.paymentStatus !== PaymentStatus.PAID) {
        // Cron phải chạy tiếp cho các dòng còn lại: chỉ cảnh báo và bỏ qua.
        skippedUnpaidCount++;
        this.logger.warn(
          `Bỏ qua kích hoạt gói ${sub.tier} của user ${sub.userId}: đơn #${sub.order?.orderCode ?? sub.orderId} chưa thanh toán (${sub.order?.paymentStatus ?? 'UNKNOWN'})`,
        );
        continue;
      }

      // Dòng ACTIVE còn sót (dữ liệu cũ) phải nhường chỗ cho lịch hẹn, nếu không
      // câu UPDATE bên dưới sẽ vi phạm unique index một-dòng-ACTIVE.
      await this.prisma.subscription.updateMany({
        where: { userId: sub.userId, status: 'ACTIVE' },
        data: { status: 'CANCELLED', autoRenew: false },
      });

      // Giữ nguyên expiresAt đã chốt lúc đặt lịch: cron chạy trễ không được tặng
      // thêm ngày nào cho khách.
      const actualExpiresAt = sub.expiresAt;

      const activated = await this.prisma.subscription.updateMany({
        where: { id: sub.id, status: 'SCHEDULED' },
        data: { status: 'ACTIVE' },
      });
      if (activated.count === 0) continue;

      await this.prisma.user.update({
        where: { id: sub.userId },
        data: { tier: sub.tier, tierExpiresAt: actualExpiresAt },
      });

      this.notificationService
        .create({
          userId: sub.userId,
          type: 'SYSTEM',
          title: `Gói ${sub.tier} đã bắt đầu`,
          message: `Gói của bạn đã kích hoạt, hiệu lực đến ${actualExpiresAt.toLocaleDateString('vi-VN')}.`,
          data: { subscriptionId: sub.id, tier: sub.tier, expiresAt: actualExpiresAt },
        })
        .catch(() => undefined);

      activatedCount++;
    }

    const totalExpired = cancelledResult.count + expiredResult.count;

    // Step C: Downgrade users to FREE
    const affectedUsers = await this.prisma.user.findMany({
      where: {
        tierExpiresAt: { lt: now, not: null },
        tier: { not: 'FREE' },
      },
      select: { id: true, tier: true },
    });

    if (affectedUsers.length > 0) {
      await this.prisma.user.updateMany({
        where: {
          tierExpiresAt: { lt: now, not: null },
          tier: { not: 'FREE' },
        },
        data: { tier: 'FREE', tierExpiresAt: null },
      });

      for (const user of affectedUsers) {
        this.notificationService
          .create({
            userId: user.id,
            type: 'SYSTEM',
            title: `Gói ${user.tier} đã hết hạn`,
            message: 'Tài khoản đã chuyển về gói Miễn phí.',
            data: { previousTier: user.tier },
          })
          .catch(() => undefined);
      }
    }

    this.logger.log(
      `Expired ${totalExpired} subscriptions (${cancelledResult.count} cancelled, ${expiredResult.count} expired), ` +
      `activated ${activatedCount} scheduled subs (skipped ${skippedUnpaidCount} unpaid), ` +
      `downgraded ${affectedUsers.length} users to FREE`,
    );

    return {
      activatedSubscriptions: activatedCount,
      skippedUnpaidSubscriptions: skippedUnpaidCount,
      cancelledSubscriptions: cancelledResult.count,
      expiredSubscriptions: expiredResult.count,
      downgradedUsers: affectedUsers.length,
    };
  }
}
