import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { AdminModule } from '../admin/admin.module';
import { GhnClient } from './providers/ghn/ghn.client';
import { GhnMapper } from './providers/ghn/ghn.mapper';
import { GhnShippingProvider } from './providers/ghn/ghn.provider';
import { ShippingProviderFactory } from './shipping-provider.factory';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { GhnWebhookController } from './webhooks/ghn-webhook.controller';

@Module({
  imports: [PrismaModule, AdminModule],
  controllers: [ShippingController, GhnWebhookController],
  providers: [ShippingService, ShippingProviderFactory, GhnClient, GhnShippingProvider, GhnMapper],
  exports: [ShippingService],
})
export class ShippingModule {}
