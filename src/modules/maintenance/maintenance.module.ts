import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [AuthModule, OrdersModule, PaymentsModule],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
