import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { QuotaService } from '../../common/services/quota.service';
import { RedisModule } from '../../common/redis/redis.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RedisModule, RealtimeModule],
  controllers: [ChatController],
  providers: [ChatService, QuotaService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}