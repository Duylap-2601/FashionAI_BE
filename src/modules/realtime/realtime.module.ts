import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeAuthService } from './realtime-auth.service';
import { RealtimeEmitter } from './realtime.emitter';

// AuthModule export TokenService (dùng verifyAccessToken + blacklist check).
// Export RealtimeEmitter để module nghiệp vụ (Orders, Payments, Notification)
// emit event mà không phụ thuộc trực tiếp vào gateway.
// Export RealtimeAuthService để ChatGateway (namespace /chat) tái dùng auth handshake.
@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, RealtimeAuthService, RealtimeEmitter],
  exports: [RealtimeEmitter, RealtimeAuthService],
})
export class RealtimeModule {}
