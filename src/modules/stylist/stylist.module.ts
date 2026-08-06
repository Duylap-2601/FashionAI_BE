import { Module } from '@nestjs/common';
import { StylistController } from './stylist.controller';
import { StylistService } from './stylist.service';
import { RedisModule } from '../../common/redis/redis.module';
import { QuotaService } from '../../common/services/quota.service';

@Module({
  imports: [RedisModule],
  controllers: [StylistController],
  providers: [StylistService, QuotaService],
  exports: [StylistService],
})
export class StylistModule {}
