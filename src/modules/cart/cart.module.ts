import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

// Export CartService để Payments bỏ món đã mua khỏi giỏ khi đơn chuyển PAID.
@Module({
  imports: [RealtimeModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
