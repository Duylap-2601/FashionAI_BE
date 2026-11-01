import { Injectable } from '@nestjs/common';
import { AiActionType, OrderStatus, Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { COLLECTED_PAYMENT_STATUSES } from '../../common/constants/order.constants';

// Đơn đã huỷ/trả hàng không còn là doanh thu bán hàng, kể cả khi tiền đã về.
const NON_REVENUE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.RETURNED,
  OrderStatus.EXPIRED,
  OrderStatus.FAILED,
];

@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const today = new Date().toISOString().split('T')[0];
    const revenueWhere: Prisma.OrderWhereInput = {
      paymentStatus: { in: COLLECTED_PAYMENT_STATUSES },
      status: { notIn: NON_REVENUE_ORDER_STATUSES },
    };

    const [userCount, productCount, orderCount, tryOnCount, tryOnTodayAgg, stylistCount, revenueAgg] =
      await Promise.all([
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
        // targetTier còn đơn bán hàng thì không. amountRefundedVnd nằm cùng nguồn
        // với amountPaidVnd nên net = gross - refunded không bị trừ trùng.
        this.prisma.order.groupBy({
          by: ['targetTier'],
          _sum: { amountPaidVnd: true, amountRefundedVnd: true },
          _count: { _all: true },
          where: revenueWhere,
        }),
      ]);

    let subscriptionRevenue = 0;
    let productRevenue = 0;
    let subscriptionRefunded = 0;
    let productRefunded = 0;
    let subscriptionOrders = 0;
    let productOrders = 0;

    for (const row of revenueAgg) {
      const paid = Number(row._sum.amountPaidVnd ?? 0);
      const refunded = Number(row._sum.amountRefundedVnd ?? 0);
      const count = row._count._all;
      if (row.targetTier) {
        subscriptionRevenue += paid;
        subscriptionRefunded += refunded;
        subscriptionOrders += count;
      } else {
        productRevenue += paid;
        productRefunded += refunded;
        productOrders += count;
      }
    }

    const totalRevenue = subscriptionRevenue + productRevenue;
    const refundedAmount = subscriptionRefunded + productRefunded;

    return {
      userCount,
      productCount,
      orderCount,
      tryOnCount,
      tryOnToday: tryOnTodayAgg._sum.count ?? 0,
      stylistCount,
      totalRevenue,
      subscriptionRevenue,
      productRevenue,
      refundedAmount,
      subscriptionRefunded,
      productRefunded,
      netRevenue: totalRevenue - refundedAmount,
      netSubscriptionRevenue: subscriptionRevenue - subscriptionRefunded,
      netProductRevenue: productRevenue - productRefunded,
      paidOrders: subscriptionOrders + productOrders,
      subscriptionOrders,
      productOrders,
    };
  }
}
