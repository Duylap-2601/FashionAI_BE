import {
  OrderConfirmationData,
  OrderStatusUpdateData,
  RefundCompletedData,
  RenewalReminderData,
} from './mail.types';

interface MailJobEnvelope {
  schemaVersion: 2;
  mailEventId: string;
  expiresAt?: string;
}

export type MailJobData =
  | (MailJobEnvelope & { kind: 'verification'; email: string; otp: string })
  | (MailJobEnvelope & { kind: 'password-reset'; email: string; token: string })
  | (MailJobEnvelope & { kind: 'order-confirmation'; email: string; order: OrderConfirmationData })
  | (MailJobEnvelope & { kind: 'order-status-update'; email: string; data: OrderStatusUpdateData })
  | (MailJobEnvelope & {
      kind: 'refund-completed';
      email: string;
      data: Omit<RefundCompletedData, 'processedAt'> & { processedAt: string };
    })
  | (MailJobEnvelope & {
      kind: 'renewal-reminder';
      email: string;
      data: Omit<RenewalReminderData, 'expiresAt'> & { expiresAt: string };
    });
