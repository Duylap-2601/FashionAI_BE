import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  MailService,
  OrderConfirmationData,
  OrderStatusUpdateData,
  RenewalReminderData,
} from './mail.service';
import { MAIL_JOB, MAIL_QUEUE } from './mail.constants';
import { MailJobData } from './mail-queue.types';

@Injectable()
export class MailQueueService {
  private readonly logger = new Logger(MailQueueService.name);

  constructor(
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue<MailJobData>,
    private readonly mailService: MailService,
  ) {}

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    await this.enqueue(
      MAIL_JOB.VERIFICATION,
      { kind: MAIL_JOB.VERIFICATION, email, token },
      () => this.mailService.sendVerificationEmail(email, token),
    );
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    await this.enqueue(
      MAIL_JOB.PASSWORD_RESET,
      { kind: MAIL_JOB.PASSWORD_RESET, email, token },
      () => this.mailService.sendPasswordResetEmail(email, token),
    );
  }

  async sendOrderConfirmationEmail(
    email: string,
    order: OrderConfirmationData,
  ): Promise<void> {
    await this.enqueue(
      MAIL_JOB.ORDER_CONFIRMATION,
      { kind: MAIL_JOB.ORDER_CONFIRMATION, email, order },
      () => this.mailService.sendOrderConfirmationEmail(email, order),
    );
  }

  async sendOrderStatusUpdateEmail(
    email: string,
    data: OrderStatusUpdateData,
  ): Promise<void> {
    await this.enqueue(
      MAIL_JOB.ORDER_STATUS_UPDATE,
      { kind: MAIL_JOB.ORDER_STATUS_UPDATE, email, data },
      () => this.mailService.sendOrderStatusUpdateEmail(email, data),
    );
  }

  async sendRenewalReminderEmail(email: string, data: RenewalReminderData): Promise<void> {
    await this.enqueue(
      MAIL_JOB.RENEWAL_REMINDER,
      {
        kind: MAIL_JOB.RENEWAL_REMINDER,
        email,
        data: { ...data, expiresAt: data.expiresAt.toISOString() },
      },
      () => this.mailService.sendRenewalReminderEmail(email, data),
    );
  }

  private async enqueue(
    name: (typeof MAIL_JOB)[keyof typeof MAIL_JOB],
    data: MailJobData,
    fallback: () => Promise<void>,
  ) {
    try {
      await this.mailQueue.add(name, data);
    } catch (err) {
      this.logger.warn(
        `Mail queue unavailable for job ${name}; sending directly. ${err instanceof Error ? err.message : String(err)}`,
      );
      await fallback();
    }
  }
}
