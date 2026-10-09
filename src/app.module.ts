import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TryOnModule } from './modules/try-on/try-on.module';
import { StylistModule } from './modules/stylist/stylist.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { OrderIssuesModule } from './modules/order-issues/order-issues.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { MailModule } from './modules/mail/mail.module';
import { StorageModule } from './modules/storage/storage.module';
import { AdminModule } from './modules/admin/admin.module';
import { ChatModule } from './modules/chat/chat.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { HealthModule } from './modules/health/health.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { NotificationModule } from './modules/notification/notification.module';
import { RackModule } from './modules/rack/rack.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { RedisModule } from './common/redis/redis.module';
import { AppLoggingModule } from './common/logging/app-logging.module';
import { parseRedisUrl } from './common/redis/redis-url.util';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AppLoggingModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = parseRedisUrl(configService.get<string>('REDIS_URL'));
        const defaultJobOptions = {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        };

        if (redisUrl) {
          return {
            connection: {
              host: redisUrl.hostname,
              port: Number(redisUrl.port || 6379),
              username: redisUrl.username || undefined,
              password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
              db: Number(redisUrl.pathname.replace('/', '') || 0),
              // rediss:// (vd Upstash) yêu cầu TLS. Parse URL ra object làm mất
              // scheme nên phải khai báo lại tls, nếu không ioredis bắt tay plain TCP
              // với endpoint chỉ nhận TLS -> queue.add() treo vô hạn (retry ngầm).
              tls: redisUrl.protocol === 'rediss:' ? {} : undefined,
              maxRetriesPerRequest: 3,
            },
            defaultJobOptions,
          };
        }

        return {
          connection: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: Number(configService.get<string>('REDIS_PORT', '6379')),
            password: configService.get<string>('REDIS_PASSWORD') || undefined,
          },
          defaultJobOptions,
        };
      },
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    PrismaModule,
    MailModule,
    StorageModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    OrdersModule,
    OrderIssuesModule,
    TryOnModule,
    StylistModule,
    PaymentsModule,
    AdminModule,
    ChatModule,
    MaintenanceModule,
    RealtimeModule,
    NotificationModule,
    RackModule,
    CollectionsModule,
    CouponsModule,
    ShippingModule,
    OutboxModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
