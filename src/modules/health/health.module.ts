import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { RedisModule } from '../../common/redis/redis.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, RedisModule, RealtimeModule],
  controllers: [HealthController],
})
export class HealthModule {}
