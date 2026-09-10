import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { NotificationModule } from '../notification/notification.module';
import { ShippingModule } from '../shipping/shipping.module';

@Module({
  imports: [NotificationModule, ShippingModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
