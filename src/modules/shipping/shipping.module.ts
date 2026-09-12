import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { AdminModule } from '../admin/admin.module';
import { GhnClient } from './providers/ghn/ghn.client';
import { GhnMapper } from './providers/ghn/ghn.mapper';
import { GhnShippingProvider } from './providers/ghn/ghn.provider';
import { ShippingProviderFactory } from './shipping-provider.factory';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { ShipmentService } from './shipment.service';
import { GhnWebhookController } from './webhooks/ghn-webhook.controller';
import { StagingSimulatorController } from './webhooks/staging-simulator.controller';

@Module({
  imports: [PrismaModule, AdminModule],
  controllers: [ShippingController, GhnWebhookController, StagingSimulatorController],
  providers: [ShippingService, ShipmentService, ShippingProviderFactory, GhnClient, GhnShippingProvider, GhnMapper],
  exports: [ShippingService, ShipmentService],
})
export class ShippingModule {}
