import { Module } from '@nestjs/common';
import { TryOnController } from './try-on.controller';
import { TryOnService } from './try-on.service';
import { RedisModule } from '../../common/redis/redis.module';
import { QuotaService } from '../../common/services/quota.service';

@Module({
  imports: [RedisModule],
  controllers: [TryOnController],
  providers: [TryOnService, QuotaService],
  exports: [TryOnService],
})
export class TryOnModule {}
