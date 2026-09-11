import {
  OrderConfirmationData,
  OrderStatusUpdateData,
  RenewalReminderData,
} from './mail.service';

export type MailJobData =
  | { kind: 'verification'; email: string; token: string }
  | { kind: 'password-reset'; email: string; token: string }
  | { kind: 'order-confirmation'; email: string; order: OrderConfirmationData }
  | { kind: 'order-status-update'; email: string; data: OrderStatusUpdateData }
  | {
      kind: 'renewal-reminder';
      email: string;
      data: Omit<RenewalReminderData, 'expiresAt'> & { expiresAt: string };
    };
