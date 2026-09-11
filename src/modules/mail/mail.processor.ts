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
    switch (job.data.kind) {
      case MAIL_JOB.VERIFICATION:
        await this.mailService.sendVerificationEmail(job.data.email, job.data.token);
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
        this.logger.warn(`Unknown mail job: ${job.name}`);
    }
  }
}
