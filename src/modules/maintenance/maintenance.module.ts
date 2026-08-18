import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [AuthModule],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
