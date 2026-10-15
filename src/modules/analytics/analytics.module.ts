import { Module } from '@nestjs/common';
import { RedisModule } from '../../common/redis/redis.module';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AnalyticsTrackingService } from './analytics-tracking.service';
import { ga4DataClientProvider } from './ga4-data-client.provider';

@Module({
  imports: [RedisModule],
  controllers: [AdminAnalyticsController],
  providers: [AnalyticsTrackingService, AdminAnalyticsService, ga4DataClientProvider],
  exports: [AnalyticsTrackingService],
})
export class AnalyticsModule {}
