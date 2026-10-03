import { OrderStatus } from '@prisma/client';

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export interface VerificationMailData {
  email: string;
  otp: string;
}

export interface PasswordResetMailData {
  email: string;
  resetUrl: string;
}

export interface OrderConfirmationItem {
  name: string;
  quantity: number;
  color?: string | null;
  price: number;
}

export interface ShippingInfo {
  name?: string;
  phone?: string;
  address?: string;
  note?: string;
}

export interface OrderConfirmationData {
  orderId: string;
  orderCode: number;
  items: OrderConfirmationItem[];
  itemsTotal: number;
  shippingFee: number;
  discountAmount: number;
  total: number;
  shippingInfo?: ShippingInfo | null;
}

export interface OrderStatusUpdateData {
  orderId: string;
  orderCode: number;
  status: OrderStatus;
  shippingInfo?: Omit<ShippingInfo, 'note'> | null;
}

export interface RenewalReminderData {
  name: string;
  tier: string;
  tierLabel: string;
  price: number;
  expiresAt: Date;
  daysRemaining: number;
  checkoutUrl: string;
  orderCode: number;
}
