import { Module } from '@nestjs/common';
import { TryOnController } from './try-on.controller';
import { TryOnService } from './try-on.service';
import { RedisModule } from '../../common/redis/redis.module';
import { QuotaService } from '../../common/services/quota.service';
import { DecartRealtimeService } from './decart-realtime.service';
import { LiveTryOnController } from './live-try-on.controller';
import { LiveTryOnService } from './live-try-on.service';

@Module({
  imports: [RedisModule],
  controllers: [TryOnController, LiveTryOnController],
  providers: [TryOnService, QuotaService, LiveTryOnService, DecartRealtimeService],
  exports: [TryOnService, LiveTryOnService],
})
export class TryOnModule {}
