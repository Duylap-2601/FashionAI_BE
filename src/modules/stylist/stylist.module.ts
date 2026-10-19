import { Module } from '@nestjs/common';
import { StylistController } from './stylist.controller';
import { StylistService } from './stylist.service';
import { RedisModule } from '../../common/redis/redis.module';
import { QuotaService } from '../../common/services/quota.service';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [RedisModule, ProductsModule],
  controllers: [StylistController],
  providers: [StylistService, QuotaService],
  exports: [StylistService],
})
export class StylistModule {}
