import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { QuotaService } from '../../common/services/quota.service';
import { RedisModule } from '../../common/redis/redis.module';

@Module({
  imports: [RedisModule],
  controllers: [ChatController],
  providers: [ChatService, QuotaService],
  exports: [ChatService],
})
export class ChatModule {}