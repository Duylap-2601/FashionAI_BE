import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { SubscriptionService } from './subscription.service';
import { MomoPaymentProvider } from './momo/momo-payment.provider';
import { MomoSignatureService } from './momo/momo-signature.service';
import { NotificationModule } from '../notification/notification.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [NotificationModule, OutboxModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, SubscriptionService, MomoPaymentProvider, MomoSignatureService],
  exports: [PaymentsService, SubscriptionService],
})
export class PaymentsModule {}
