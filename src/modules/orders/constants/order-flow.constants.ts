import { OrderStatus } from '@prisma/client';
import { MeasurementField } from '../../../common/constants/measurement.constants';

export const ONLINE_PAYMENT_METHODS = ['BANK_TRANSFER', 'BANK', 'SEPAY'] as const;

// Các trường số đo được chụp lại khi đặt đơn để đóng băng dữ liệu sản xuất.
export const MEASUREMENT_SNAPSHOT_FIELDS: MeasurementField[] = [
  'height',
  'weight',
  'chest',
  'waist',
  'hip',
  'shoulder',
  'neck',
  'sleeveLength',
  'wrist',
  'thigh',
  'knee',
  'calf',
  'inseam',
  'outseam',
  'shirtLength',
  'underbust',
];

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_INT4 = 2_147_483_647;

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [
    OrderStatus.CANCELLED,
    OrderStatus.EXPIRED,
    OrderStatus.FAILED,
  ],
  [OrderStatus.PAID]: [
    OrderStatus.CONFIRMED,
    OrderStatus.MEASUREMENT_REVIEW,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.MEASUREMENT_REVIEW]: [
    OrderStatus.MEASUREMENT_CONFIRMED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.MEASUREMENT_CONFIRMED]: [
    OrderStatus.TAILORING,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.TAILORING]: [OrderStatus.QUALITY_CHECK],
  [OrderStatus.QUALITY_CHECK]: [
    OrderStatus.READY_TO_SHIP,
    OrderStatus.TAILORING,
  ],
  [OrderStatus.READY_TO_SHIP]: [OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.SHIPPING, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPING]: [OrderStatus.DELIVERED, OrderStatus.RETURNED],
  [OrderStatus.DELIVERED]: [OrderStatus.RETURNED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.RETURNED]: [],
  [OrderStatus.EXPIRED]: [],
  [OrderStatus.FAILED]: [],
};

export const STOCK_DECREMENTED_STATES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.CONFIRMED,
  OrderStatus.SHIPPING,
  OrderStatus.DELIVERED,
];

export const STATUS_NOTIFY_EMAIL: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.CANCELLED,
];

export const ORDER_STATUS_MESSAGE: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.PAID]: 'Đơn hàng đã được thanh toán.',
  [OrderStatus.CONFIRMED]: 'Đơn hàng đã được xác nhận và đang chuẩn bị.',
  [OrderStatus.MEASUREMENT_REVIEW]: 'Shop đang kiểm tra số đo cho đơn may đo.',
  [OrderStatus.MEASUREMENT_CONFIRMED]: 'Số đo của đơn hàng đã được xác nhận.',
  [OrderStatus.TAILORING]: 'Đơn hàng đang được may.',
  [OrderStatus.QUALITY_CHECK]: 'Đơn hàng đang được kiểm tra chất lượng.',
  [OrderStatus.READY_TO_SHIP]: 'Đơn hàng đã sẵn sàng bàn giao vận chuyển.',
  [OrderStatus.SHIPPING]: 'Đơn hàng đang được giao đến bạn.',
  [OrderStatus.DELIVERED]: 'Đơn hàng đã được giao thành công.',
  [OrderStatus.CANCELLED]: 'Đơn hàng đã bị hủy.',
  [OrderStatus.RETURNED]: 'Đơn hàng đã được hoàn trả.',
  [OrderStatus.EXPIRED]: 'Đơn hàng đã hết hạn thanh toán.',
  [OrderStatus.FAILED]: 'Đơn hàng thanh toán thất bại.',
};
