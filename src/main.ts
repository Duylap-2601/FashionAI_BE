import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { parseCorsOrigins } from './common/utils/cors-origins.util';
import { RedisIoAdapter } from './common/redis/redis-io.adapter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const apiPrefix = process.env.API_PREFIX ?? 'api';
  const swaggerPath = process.env.SWAGGER_PATH ?? 'docs';
  const swaggerEnabled = parseBoolean(process.env.SWAGGER_ENABLED, true);

  app.use(cookieParser());
  app.setGlobalPrefix(apiPrefix, { exclude: ['/'] });

  const corsCredentials = parseBoolean(process.env.CORS_CREDENTIALS, true);
  const isProduction = process.env.NODE_ENV === 'production';

  // Render đặt reverse proxy trước app. Khai báo số hop tin cậy để Express tự suy
  // ra req.ip từ phần X-Forwarded-For do proxy của mình thêm vào, thay vì tin phần
  // tử đầu tiên (client đặt được -> bypass rate limit). 0 = chạy trực tiếp, local.
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? (isProduction ? 1 : 0));
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);

  app.enableCors({
    origin: parseCorsOrigins(
      process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN,
      corsCredentials,
      isProduction,
      logger,
    ),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Platform'],
    credentials: corsCredentials,
  });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(process.env.SWAGGER_TITLE ?? 'AI Fashion Try-On API')
      .setDescription(
        process.env.SWAGGER_DESCRIPTION ??
          `## Hệ thống thử đồ AI tích hợp 2 công nghệ:\n` +
            `- **Virtual Try-On** (FASHN): Tạo ảnh thử đồ thực tế\n` +
            `- **AI Stylist** (Gemini Vision): Phân tích Personal Color và tư vấn phong cách`,
      )
      .setVersion(process.env.SWAGGER_VERSION ?? '2.0.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: `Nhap accessToken lay tu /${apiPrefix}/auth/login hoac /${apiPrefix}/auth/register`,
        },
        'access-token',
      )
      .addTag('Health', 'Kiểm tra trạng thái hệ thống (DB, Redis)')
      .addTag('Auth', 'Xác thực và quản lý tài khoản')
      .addTag('Users', 'Quản lý hồ sơ & số đo người dùng')
      .addTag('Products', 'Quản lý danh mục sản phẩm thời trang')
      .addTag('Virtual Try-On', 'Thử đồ ảo AI bằng fal.ai (FASHN v1.6)')
      .addTag('AI Stylist', 'Tư vấn phong cách bằng Gemini Vision')
      .addTag('Orders', 'Đơn hàng sản phẩm')
      .addTag('Payments & Subscriptions', 'Thanh toán SePay & Nâng cấp tài khoản')
      .addTag('Admin', 'Thống kê & quản trị hệ thống')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/${swaggerPath}`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = process.env.PORT ?? 3000;

  // Gắn WebSocket adapter TRƯỚC listen. Có REDIS_URL thì bật Redis adapter để
  // fan-out event qua mọi instance; không có thì dùng adapter mặc định
  // (in-memory) cho dev 1 instance.
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis(redisUrl);
    app.useWebSocketAdapter(redisIoAdapter);
    logger.log('WebSocket: Redis adapter enabled (multi-instance fan-out)');
  } else {
    logger.log('WebSocket: default in-memory adapter (single instance)');
  }

  // Bind 0.0.0.0 thay vì để Node tự chọn: PaaS (Render, Fly, ...) chỉ route được
  // traffic tới process nghe trên mọi interface.
  await app.listen(port, '0.0.0.0');

  logger.log(`Server running at: http://localhost:${port}/${apiPrefix}`);
  if (swaggerEnabled) {
    logger.log(`Swagger UI:        http://localhost:${port}/${apiPrefix}/${swaggerPath}`);
  }
  logger.log(`Try-On endpoint:   POST http://localhost:${port}/${apiPrefix}/try-on`);
  logger.log(`Stylist endpoint:  POST http://localhost:${port}/${apiPrefix}/stylist/analyze`);
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

bootstrap();
