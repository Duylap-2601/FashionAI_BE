import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MAIL_QUEUE } from './mail.constants';
import { MailProcessor } from './mail.processor';
import { MailQueueService } from './mail-queue.service';
import { MailService } from './mail.service';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: MAIL_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { age: 24 * 60 * 60, count: 100 },
      },
    }),
  ],
  providers: [MailService, MailQueueService, MailProcessor],
  exports: [MailService, MailQueueService],
})
export class MailModule {}
