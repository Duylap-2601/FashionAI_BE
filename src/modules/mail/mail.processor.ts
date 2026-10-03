import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailService } from './mail.service';
import { MAIL_JOB, MAIL_QUEUE } from './mail.constants';
import { MailJobData } from './mail-queue.types';

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<MailJobData>): Promise<void> {
    if (!this.isValidJob(job)) {
      job.discard();
      throw new Error(`Malformed mail job: ${job.name}`);
    }

    if (job.data.expiresAt && new Date(job.data.expiresAt).getTime() <= Date.now()) {
      job.discard();
      this.logger.warn(`Discarded expired mail job: ${job.name}`);
      return;
    }

    switch (job.data.kind) {
      case MAIL_JOB.VERIFICATION:
        await this.mailService.sendVerificationEmail(job.data.email, job.data.otp);
        break;
      case MAIL_JOB.PASSWORD_RESET:
        await this.mailService.sendPasswordResetEmail(job.data.email, job.data.token);
        break;
      case MAIL_JOB.ORDER_CONFIRMATION:
        await this.mailService.sendOrderConfirmationEmail(job.data.email, job.data.order);
        break;
      case MAIL_JOB.ORDER_STATUS_UPDATE:
        await this.mailService.sendOrderStatusUpdateEmail(job.data.email, job.data.data);
        break;
      case MAIL_JOB.RENEWAL_REMINDER:
        await this.mailService.sendRenewalReminderEmail(job.data.email, {
          ...job.data.data,
          expiresAt: new Date(job.data.data.expiresAt),
        });
        break;
      default:
        job.discard();
        throw new Error(`Unknown mail job: ${job.name}`);
    }
  }

  private isValidJob(job: Job<MailJobData>): boolean {
    const data = job.data as MailJobData | undefined;
    if (!data || data.schemaVersion !== 2) return false;
    if (job.name !== data.kind) return false;
    if (!this.isEmail(data.email)) return false;
    if (!data.mailEventId || data.mailEventId.length > 200) return false;
    if (data.expiresAt && Number.isNaN(new Date(data.expiresAt).getTime())) return false;
    return true;
  }

  private isEmail(value: string): boolean {
    return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
}
