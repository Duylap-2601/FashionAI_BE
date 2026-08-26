import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

// RealtimeModule export RealtimeEmitter. Export NotificationService để Orders và
// Payments tạo notification khi trạng thái đơn đổi.
@Module({
  imports: [RealtimeModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
