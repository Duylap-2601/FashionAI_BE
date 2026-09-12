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
import { ShippingModule } from './modules/shipping/shipping.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { RedisModule } from './common/redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        const defaultJobOptions = {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        };

        if (redisUrl) {
          const url = new URL(redisUrl);
          return {
            connection: {
              host: url.hostname,
              port: Number(url.port || 6379),
              username: url.username || undefined,
              password: url.password ? decodeURIComponent(url.password) : undefined,
              db: Number(url.pathname.replace('/', '') || 0),
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
