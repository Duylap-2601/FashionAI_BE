import { Module } from '@nestjs/common';
import { AdminController } from './admin-stats.controller';
import { AdminStatsService } from './admin-stats.service';
import { AdminSettingsService } from './admin-settings.service';

@Module({
  controllers: [AdminController],
  providers: [AdminStatsService, AdminSettingsService],
  exports: [AdminSettingsService],
})
export class AdminModule {}
