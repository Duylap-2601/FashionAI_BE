import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { AdminModule } from '../admin/admin.module';
import { AdminShipmentsController } from './admin-shipments.controller';
import { AdminShipmentsService } from './admin-shipments.service';
import { GhnLocationSyncService } from './ghn-location-sync.service';
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
  imports: [PrismaModule, RedisModule, AdminModule],
  controllers: [ShippingController, AdminShipmentsController, GhnWebhookController, StagingSimulatorController],
  providers: [ShippingService, ShipmentService, AdminShipmentsService, GhnLocationSyncService, ShippingProviderFactory, GhnClient, GhnShippingProvider, GhnMapper],
  exports: [ShippingService, ShipmentService],
})
export class ShippingModule {}
