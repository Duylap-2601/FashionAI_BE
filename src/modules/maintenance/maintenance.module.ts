import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [AuthModule, PaymentsModule],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
