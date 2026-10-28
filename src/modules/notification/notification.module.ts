import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { DeviceTokenController } from './device-token.controller';
import { DeviceTokenService } from './device-token.service';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { PushService } from './push.service';

// RealtimeModule export RealtimeEmitter. Export NotificationService để Orders và
// Payments tạo notification khi trạng thái đơn đổi.
@Module({
  imports: [RealtimeModule],
  controllers: [NotificationController, DeviceTokenController],
  providers: [NotificationService, DeviceTokenService, PushService],
  exports: [NotificationService],
})
export class NotificationModule {}
