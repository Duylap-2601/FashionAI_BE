import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { SubscriptionService } from './subscription.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, SubscriptionService],
  exports: [PaymentsService, SubscriptionService],
})
export class PaymentsModule {}
