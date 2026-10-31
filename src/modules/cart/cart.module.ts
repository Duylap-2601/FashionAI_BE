import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { SaleCampaignsModule } from '../sale-campaigns/sale-campaigns.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

// Export CartService để Payments bỏ món đã mua khỏi giỏ khi đơn chuyển PAID.
@Module({
  imports: [RealtimeModule, SaleCampaignsModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
