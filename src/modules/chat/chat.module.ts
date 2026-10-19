import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { QuotaService } from '../../common/services/quota.service';
import { RedisModule } from '../../common/redis/redis.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [RedisModule, RealtimeModule, ProductsModule],
  controllers: [ChatController],
  providers: [ChatService, QuotaService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}