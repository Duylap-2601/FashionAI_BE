import { Module } from '@nestjs/common';
import { RedisModule } from '../../common/redis/redis.module';
import { NotificationModule } from '../notification/notification.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { StorageModule } from '../storage/storage.module';
import { MyOrderChatsController } from './my-order-chats.controller';
import { OrderChatController } from './order-chat.controller';
import { OrderChatService } from './order-chat.service';

@Module({
  imports: [NotificationModule, RealtimeModule, StorageModule, RedisModule],
  controllers: [OrderChatController, MyOrderChatsController],
  providers: [OrderChatService],
  exports: [OrderChatService],
})
export class OrderChatModule {}
