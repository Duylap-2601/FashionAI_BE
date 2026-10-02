import { Injectable } from '@nestjs/common';
import { AiActionType, ProductStatus, RefundStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PAID_STATUSES } from '../../common/constants/order.constants';

@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const today = new Date().toISOString().split('T')[0];

    const [
      userCount,
      productCount,
      orderCount,
      tryOnCount,
      tryOnTodayAgg,
      stylistCount,
      revenueAgg,
      completedRefunds,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.product.count({ where: { status: ProductStatus.ACTIVE } }),
      this.prisma.order.count(),
      this.prisma.tryOnResult.count(),
      this.prisma.dailyUsage.aggregate({
        _sum: { count: true },
        where: { action: AiActionType.TRY_ON, date: today },
      }),
      this.prisma.stylistResult.count(),
      // Doanh thu chỉ tính đơn đã có tiền về; tách 2 luồng vì đơn nâng gói có
      // targetTier còn đơn bán hàng thì không.
      this.prisma.order.groupBy({
        by: ['targetTier'],
        _sum: { amount: true },
        _count: { _all: true },
        where: { status: { in: PAID_STATUSES } },
      }),
      // Hoàn tiền đã xử lý xong để tính doanh thu net; giữ gross nguyên cho FE cũ.
      this.prisma.refund.findMany({
        where: { status: RefundStatus.COMPLETED },
        select: {
          amountVnd: true,
          order: { select: { targetTier: true } },
        },
      }),
    ]);

    let subscriptionRevenue = 0;
    let productRevenue = 0;
    let subscriptionOrders = 0;
    let productOrders = 0;

    for (const row of revenueAgg) {
      const amount = Number(row._sum.amount ?? 0);
      const count = row._count._all;
      if (row.targetTier) {
        subscriptionRevenue += amount;
        subscriptionOrders += count;
      } else {
        productRevenue += amount;
        productOrders += count;
      }
    }

    let subscriptionRefunded = 0;
    let productRefunded = 0;
    for (const refund of completedRefunds) {
      const amount = Number(refund.amountVnd ?? 0);
      if (refund.order?.targetTier) {
        subscriptionRefunded += amount;
      } else {
        productRefunded += amount;
      }
    }
    const refundedAmount = subscriptionRefunded + productRefunded;

    return {
      userCount,
      productCount,
      orderCount,
      tryOnCount,
      tryOnToday: tryOnTodayAgg._sum.count ?? 0,
      stylistCount,
      totalRevenue: subscriptionRevenue + productRevenue,
      subscriptionRevenue,
      productRevenue,
      refundedAmount,
      subscriptionRefunded,
      productRefunded,
      netRevenue: subscriptionRevenue + productRevenue - refundedAmount,
      netSubscriptionRevenue: subscriptionRevenue - subscriptionRefunded,
      netProductRevenue: productRevenue - productRefunded,
      paidOrders: subscriptionOrders + productOrders,
      subscriptionOrders,
      productOrders,
    };
  }
}
