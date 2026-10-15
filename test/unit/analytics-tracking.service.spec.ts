import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import {
  AnalyticsTrackingService,
  buildPurchasePayload,
} from '../../src/modules/analytics/analytics-tracking.service';

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return { __esModule: true, default: { post: jest.fn(), isAxiosError: actual.default.isAxiosError } };
});

const mockedPost = axios.post as jest.Mock;

const productOrder = {
  id: 'order-1',
  orderCode: 12345678,
  userId: 'user-1',
  targetTier: null,
  amount: 1320000,
  currency: 'VND',
  taxVnd: BigInt(0),
  shippingFeeVnd: BigInt(30000),
  couponCode: 'SALE10',
  gaClientId: '111.222',
  gaSessionId: '1700000000',
  items: [
    {
      productId: 'product-1',
      productNameSnapshot: 'Suit Navy',
      brandSnapshot: 'StAle.',
      productCategorySnapshot: 'Suit',
      comboType: 'combo',
      color: 'Navy',
      unitPriceVnd: BigInt(1290000),
      price: 1290000,
      quantity: 1,
    },
  ],
};

function createService(env: Record<string, string>, order: unknown = productOrder) {
  const prisma = { order: { findUnique: jest.fn().mockResolvedValue(order) } };
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return { service: new AnalyticsTrackingService(config, prisma as any), prisma };
}

const ENABLED_ENV = {
  GA4_TRACKING_ENABLED: 'true',
  GA4_MEASUREMENT_ID: 'G-TEST',
  GA4_API_SECRET: 'super-secret',
};

describe('buildPurchasePayload', () => {
  it('dựng purchase cho đơn sản phẩm với transaction_id là orderCode', () => {
    const payload = buildPurchasePayload(productOrder as any);

    expect(payload.client_id).toBe('111.222');
    expect(payload.user_id).toBe('user-1');
    expect(payload.events[0]).toEqual({
      name: 'purchase',
      params: {
        transaction_id: '12345678',
        currency: 'VND',
        value: 1320000,
        tax: 0,
        shipping: 30000,
        coupon: 'SALE10',
        session_id: '1700000000',
        engagement_time_msec: 1,
        items: [
          {
            item_id: 'product-1',
            item_name: 'Suit Navy',
            item_brand: 'StAle.',
            item_category: 'Suit',
            item_variant: 'combo / Navy',
            price: 1290000,
            quantity: 1,
          },
        ],
      },
    });
  });

  it('đơn không có gaClientId dùng client_id riêng và không gửi user_id', () => {
    const payload = buildPurchasePayload({ ...productOrder, gaClientId: null, gaSessionId: null } as any);

    expect(payload.client_id).toBe('srv.12345678');
    expect(payload).not.toHaveProperty('user_id');
    expect(payload.events[0].params).not.toHaveProperty('session_id');
  });

  it('đơn nâng cấp gói là một item subscription', () => {
    const payload = buildPurchasePayload({
      ...productOrder,
      targetTier: 'VIP',
      amount: 99000,
      shippingFeeVnd: null,
      couponCode: null,
      items: [],
    } as any);

    expect(payload.events[0].params.items).toEqual([
      { item_id: 'subscription_vip', item_name: 'Gói VIP', item_category: 'Subscription', price: 99000, quantity: 1 },
    ]);
    expect(payload.events[0].params.shipping).toBe(0);
  });
});

describe('AnalyticsTrackingService.trackPurchase', () => {
  beforeEach(() => mockedPost.mockReset());

  it('không gửi gì khi tắt tracking', async () => {
    const { service, prisma } = createService({ ...ENABLED_ENV, GA4_TRACKING_ENABLED: 'false' });

    await service.trackPurchase('order-1', 'SEPAY');

    expect(prisma.order.findUnique).not.toHaveBeenCalled();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('bỏ qua đơn thanh toán bằng mock sandbox', async () => {
    const { service } = createService(ENABLED_ENV);

    await service.trackPurchase('order-1', 'MOCK_SANDBOX');

    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('gửi tới Measurement Protocol với measurement_id và api_secret', async () => {
    mockedPost.mockResolvedValue({ data: {} });
    const { service } = createService(ENABLED_ENV);

    await service.trackPurchase('order-1', 'SEPAY');

    expect(mockedPost).toHaveBeenCalledWith(
      'https://www.google-analytics.com/mp/collect',
      expect.objectContaining({ client_id: '111.222' }),
      expect.objectContaining({ params: { measurement_id: 'G-TEST', api_secret: 'super-secret' } }),
    );
  });

  it('ném lỗi để outbox retry nhưng không lộ api_secret', async () => {
    const axiosError = Object.assign(new Error('Request failed for ...api_secret=super-secret'), {
      isAxiosError: true,
      response: { status: 500 },
    });
    mockedPost.mockRejectedValue(axiosError);
    const { service } = createService(ENABLED_ENV);

    const error = await service.trackPurchase('order-1', 'SEPAY').catch((err: Error) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('500');
    expect((error as Error).message).not.toContain('super-secret');
  });

  it('không lỗi khi đơn không còn tồn tại', async () => {
    const { service } = createService(ENABLED_ENV, null);

    await expect(service.trackPurchase('order-x', 'SEPAY')).resolves.toBeUndefined();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
