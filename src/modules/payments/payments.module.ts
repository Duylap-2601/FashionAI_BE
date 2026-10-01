import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { SubscriptionService } from './subscription.service';
import { MomoPaymentProvider } from './momo/momo-payment.provider';
import { MomoSignatureService } from './momo/momo-signature.service';
import { MomoGateway } from './momo/momo.gateway';
import { ZaloPayGateway } from './zalopay/zalopay.gateway';
import { PAYMENT_GATEWAYS, PaymentGatewayRegistry } from './gateways/payment-gateway.registry';
import { NotificationModule } from '../notification/notification.module';
import { OutboxModule } from '../outbox/outbox.module';
import { RedisModule } from '../../common/redis/redis.module';

@Module({
  imports: [NotificationModule, OutboxModule, RedisModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    SubscriptionService,
    MomoPaymentProvider,
    MomoSignatureService,
    MomoGateway,
    ZaloPayGateway,
    PaymentGatewayRegistry,
    {
      provide: PAYMENT_GATEWAYS,
      useFactory: (momo: MomoGateway, zalopay: ZaloPayGateway) => [momo, zalopay],
      inject: [MomoGateway, ZaloPayGateway],
    },
  ],
  exports: [PaymentsService, SubscriptionService],
})
export class PaymentsModule {}
