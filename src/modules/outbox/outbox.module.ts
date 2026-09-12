import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OUTBOX_QUEUE } from './constants/outbox.constants';
import { OutboxProcessor } from './processors/outbox.processor';
import { OutboxService } from './services/outbox.service';
import { PrismaModule } from '../../database/prisma.module';
import { ShippingModule } from '../shipping/shipping.module';

@Module({
  imports: [
    PrismaModule,
    ShippingModule,
    BullModule.registerQueue({
      name: OUTBOX_QUEUE,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 200,
      },
    }),
  ],
  providers: [OutboxService, OutboxProcessor],
  exports: [OutboxService],
})
export class OutboxModule {}
