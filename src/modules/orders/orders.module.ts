import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { NotificationModule } from '../notification/notification.module';
import { ShippingModule } from '../shipping/shipping.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [NotificationModule, ShippingModule, UsersModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
