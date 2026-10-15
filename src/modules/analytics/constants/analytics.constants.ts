export const GA4_DATA_CLIENT = Symbol('GA4_DATA_CLIENT');

export const ANALYTICS_RANGES = ['7d', '28d', '90d'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const ANALYTICS_RANGE_DAYS: Record<AnalyticsRange, number> = {
  '7d': 7,
  '28d': 28,
  '90d': 90,
};

// Báo cáo GA4 tự có độ trễ xử lý vài giờ nên cache 15 phút không làm số liệu cũ đi
// đáng kể, nhưng giữ quota Data API của property ở mức thấp.
export const REPORT_CACHE_TTL_SECONDS = 15 * 60;
// Báo cáo chưa có lượt truy cập nào (GA4 chưa xử lý xong số liệu mới) chỉ cache ngắn, để số
// liệu vừa có không bị giữ lại sau một bản rỗng suốt 15 phút.
export const EMPTY_REPORT_CACHE_TTL_SECONDS = 60;
export const REALTIME_CACHE_TTL_SECONDS = 60;

/**
 * Tên event là hợp đồng với FE (src/lib/analytics). Đổi tên ở đây phải đổi cả FE,
 * nếu không phễu và bảng tính năng sẽ về 0.
 */
export const FUNNEL_EVENTS = ['view_item', 'add_to_cart', 'begin_checkout', 'purchase'] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export const FEATURE_EVENTS = [
  'try_on_generate',
  'live_try_on_start',
  'stylist_analyze',
  'chat_message_send',
  'add_to_wishlist',
  'search',
] as const;
export type FeatureEvent = (typeof FEATURE_EVENTS)[number];

/** Đơn thanh toán bằng mock sandbox là dữ liệu test, không được tính vào doanh thu GA4. */
export const GA4_EXCLUDED_PROVIDERS = new Set(['MOCK_SANDBOX']);

/** Múi giờ dùng để dựng trục ngày cho biểu đồ; khớp với múi giờ của property GA4. */
export const ANALYTICS_TIMEZONE = 'Asia/Ho_Chi_Minh';
