import { OutboxEventType } from '../constants/outbox.constants';

export interface OutboxJobData {
  eventKey: string;
  type: OutboxEventType;
  aggregateType: string;
  aggregateId: string;
  payload?: Record<string, unknown>;
}

export interface ShipmentCreatePayload {
  orderId: string;
  shipmentId: string;
}

export interface ShipmentCancelPayload {
  orderId: string;
  shipmentId: string;
}

export interface RefundCreatePayload {
  orderId: string;
  paymentId: string;
  amountVnd: number;
  reason?: string;
}

export interface PaymentPostSuccessPayload {
  orderId: string;
  orderCode: number;
  userId: string;
}
