import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import {
  OrderConfirmationData,
  OrderStatusUpdateData,
  RenewalReminderData,
} from './mail.types';
import { MAIL_JOB, MAIL_QUEUE } from './mail.constants';
import { MailJobData } from './mail-queue.types';

@Injectable()
export class MailQueueService {
  private readonly logger = new Logger(MailQueueService.name);

  constructor(
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue<MailJobData>,
  ) {}

  async sendVerificationEmail(email: string, otp: string): Promise<void> {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await this.enqueue(
      MAIL_JOB.VERIFICATION,
      { schemaVersion: 2, mailEventId: randomUUID(), expiresAt, kind: MAIL_JOB.VERIFICATION, email, otp },
    );
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await this.enqueue(
      MAIL_JOB.PASSWORD_RESET,
      { schemaVersion: 2, mailEventId: randomUUID(), expiresAt, kind: MAIL_JOB.PASSWORD_RESET, email, token },
    );
  }

  async sendOrderConfirmationEmail(
    email: string,
    order: OrderConfirmationData,
  ): Promise<void> {
    await this.enqueue(
      MAIL_JOB.ORDER_CONFIRMATION,
      { schemaVersion: 2, mailEventId: this.eventId(MAIL_JOB.ORDER_CONFIRMATION, { orderId: order.orderId, orderCode: order.orderCode }), kind: MAIL_JOB.ORDER_CONFIRMATION, email, order },
    );
  }

  async sendOrderStatusUpdateEmail(
    email: string,
    data: OrderStatusUpdateData,
  ): Promise<void> {
    await this.enqueue(
      MAIL_JOB.ORDER_STATUS_UPDATE,
      { schemaVersion: 2, mailEventId: this.eventId(MAIL_JOB.ORDER_STATUS_UPDATE, { orderId: data.orderId, orderCode: data.orderCode, status: data.status }), kind: MAIL_JOB.ORDER_STATUS_UPDATE, email, data },
    );
  }

  async sendRenewalReminderEmail(email: string, data: RenewalReminderData): Promise<void> {
    await this.enqueue(
      MAIL_JOB.RENEWAL_REMINDER,
      {
        schemaVersion: 2,
        mailEventId: this.eventId(MAIL_JOB.RENEWAL_REMINDER, { email, orderCode: data.orderCode, expiresAt: data.expiresAt.toISOString() }),
        kind: MAIL_JOB.RENEWAL_REMINDER,
        email,
        data: { ...data, expiresAt: data.expiresAt.toISOString() },
      },
    );
  }

  private async enqueue(
    name: (typeof MAIL_JOB)[keyof typeof MAIL_JOB],
    data: MailJobData,
  ) {
    try {
      await this.mailQueue.add(name, data, {
        jobId: this.eventId(name, { mailEventId: data.mailEventId }),
        removeOnComplete: true,
        removeOnFail: { age: 24 * 60 * 60, count: 100 },
      });
    } catch (err) {
      this.logger.error(
        `Mail queue unavailable for job ${name}; not sending directly. ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  private eventId(kind: string, payload: Record<string, unknown>): string {
    return createHash('sha256')
      .update(JSON.stringify({ version: 2, kind, ...payload }))
      .digest('base64url');
  }
}
