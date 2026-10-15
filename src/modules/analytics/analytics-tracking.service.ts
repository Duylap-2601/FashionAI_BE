import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import axios from 'axios';
import { PrismaService } from '../../database/prisma.service';
import { GA4_EXCLUDED_PROVIDERS } from './constants/analytics.constants';

const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const MP_DEBUG_ENDPOINT = 'https://www.google-analytics.com/debug/mp/collect';
const MP_TIMEOUT_MS = 10_000;

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

export interface Ga4Item {
  item_id: string;
  item_name: string;
  item_brand?: string;
  item_category?: string;
  item_variant?: string;
  price: number;
  quantity: number;
}

export interface Ga4PurchasePayload {
  client_id: string;
  user_id?: string;
  events: {
    name: 'purchase';
    params: {
      transaction_id: string;
      currency: string;
      value: number;
      tax: number;
      shipping: number;
      coupon?: string;
      items: Ga4Item[];
      session_id?: string;
      engagement_time_msec: number;
    };
  }[];
}

/**
 * Dựng event `purchase` từ đơn đã thanh toán. `transaction_id` là orderCode để GA4
 * tự loại trùng nếu job outbox chạy lại.
 *
 * Đơn không có `gaClientId` (người dùng từ chối cookie hoặc chặn GA) vẫn được gửi để
 * doanh thu không hụt, nhưng với client_id riêng cho đơn và không kèm user_id, nên
 * GA4 không nối được đơn đó với lịch sử duyệt web của người dùng.
 */
export function buildPurchasePayload(order: OrderWithItems): Ga4PurchasePayload {
  const items: Ga4Item[] = order.targetTier
    ? [
        {
          item_id: `subscription_${order.targetTier.toLowerCase()}`,
          item_name: `Gói ${order.targetTier}`,
          item_category: 'Subscription',
          price: Number(order.amount),
          quantity: 1,
        },
      ]
    : order.items.map((item) => ({
        item_id: item.productId,
        item_name: item.productNameSnapshot ?? item.productId,
        item_brand: item.brandSnapshot ?? undefined,
        item_category: item.productCategorySnapshot ?? undefined,
        item_variant: [item.comboType, item.color].filter(Boolean).join(' / ') || undefined,
        price: Number(item.unitPriceVnd ?? item.price),
        quantity: item.quantity,
      }));

  return {
    client_id: order.gaClientId ?? `srv.${order.orderCode}`,
    ...(order.gaClientId ? { user_id: order.userId } : {}),
    events: [
      {
        name: 'purchase',
        params: {
          transaction_id: String(order.orderCode),
          currency: order.currency || 'VND',
          value: Number(order.amount),
          tax: Number(order.taxVnd ?? 0),
          shipping: Number(order.shippingFeeVnd ?? 0),
          ...(order.couponCode ? { coupon: order.couponCode } : {}),
          items,
          ...(order.gaClientId && order.gaSessionId ? { session_id: order.gaSessionId } : {}),
          // GA4 chỉ gắn event vào phiên khi có engagement_time_msec.
          engagement_time_msec: 1,
        },
      },
    ],
  };
}

@Injectable()
export class AnalyticsTrackingService {
  private readonly logger = new Logger(AnalyticsTrackingService.name);
  private readonly enabled: boolean;
  private readonly debug: boolean;
  private readonly measurementId?: string;
  private readonly apiSecret?: string;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.measurementId = configService.get<string>('GA4_MEASUREMENT_ID')?.trim() || undefined;
    this.apiSecret = configService.get<string>('GA4_API_SECRET')?.trim() || undefined;
    this.debug = configService.get<string>('GA4_MP_DEBUG') === 'true';
    this.enabled =
      configService.get<string>('GA4_TRACKING_ENABLED') === 'true' &&
      Boolean(this.measurementId && this.apiSecret);
  }

  /**
   * Gửi `purchase` cho đơn vừa thanh toán. Ném lỗi khi GA4 không nhận để job outbox
   * retry; các trường hợp cố ý bỏ qua (tắt tracking, đơn mock) thì return êm.
   */
  async trackPurchase(orderId: string, provider?: string): Promise<void> {
    if (!this.enabled) return;
    if (provider && GA4_EXCLUDED_PROVIDERS.has(provider)) return;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) {
      this.logger.warn(`Bỏ qua GA4 purchase: không tìm thấy đơn ${orderId}`);
      return;
    }

    await this.send(buildPurchasePayload(order));
    this.logger.log(`Đã gửi GA4 purchase cho đơn #${order.orderCode}`);
  }

  private async send(payload: Ga4PurchasePayload) {
    try {
      const res = await axios.post(this.debug ? MP_DEBUG_ENDPOINT : MP_ENDPOINT, payload, {
        params: { measurement_id: this.measurementId, api_secret: this.apiSecret },
        timeout: MP_TIMEOUT_MS,
      });
      if (this.debug) {
        this.logger.log(`GA4 validation: ${JSON.stringify(res.data?.validationMessages ?? [])}`);
      }
    } catch (err) {
      // Lỗi axios mang theo config có api_secret trong URL: chỉ ném lại phần an toàn
      // để logger của outbox không in secret ra log.
      const status = axios.isAxiosError(err) ? err.response?.status ?? err.code : undefined;
      throw new Error(`GA4 Measurement Protocol thất bại (${status ?? 'unknown'})`);
    }
  }
}
