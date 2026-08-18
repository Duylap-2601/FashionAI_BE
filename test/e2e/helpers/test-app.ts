import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { PrismaService } from '../../../src/database/prisma.service';
import { RedisService } from '../../../src/common/services/redis.service';
import { GlobalExceptionFilter } from '../../../src/common/filters/http-exception.filter';

/**
 * E2E ở đây chạy toàn bộ HTTP stack thật (routing, guard, pipe, filter) nhưng thay
 * Prisma và Redis bằng test double, nên không cần Postgres/Redis để chạy trong CI.
 */
export type PrismaMock = Record<string, any>;

export function createPrismaMock(overrides: PrismaMock = {}): PrismaMock {
  // Mọi method mặc định trả về Promise: code thật gọi `.catch()` trực tiếp trên
  // kết quả Prisma (ví dụ QuotaService.consumeQuota), nên jest.fn() trả undefined
  // sẽ làm request nổ 500 thay vì bộc lộ lỗi thật.
  const model = () => ({
    findUnique: jest.fn().mockResolvedValue(null),
    findUniqueOrThrow: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
    groupBy: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue({}),
  });

  const base: PrismaMock = {
    user: model(),
    measurement: model(),
    refreshToken: model(),
    passwordResetToken: model(),
    emailVerificationToken: model(),
    product: model(),
    productImage: model(),
    tryOnResult: model(),
    stylistResult: model(),
    avatar: model(),
    order: model(),
    orderItem: model(),
    payment: model(),
    dailyUsage: model(),
    $transaction: jest.fn((steps: unknown) =>
      Array.isArray(steps) ? Promise.all(steps) : Promise.resolve(steps),
    ),
    $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    enableShutdownHooks: jest.fn(),
    onModuleInit: jest.fn(),
  };

  for (const [key, value] of Object.entries(overrides)) {
    base[key] = { ...(base[key] ?? {}), ...value };
  }

  return base;
}

export function createRedisMock() {
  const store = new Map<string, string>();
  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    incr: jest.fn(async (key: string) => {
      const next = Number(store.get(key) ?? '0') + 1;
      store.set(key, String(next));
      return next;
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(undefined),
    health: jest.fn().mockResolvedValue({ status: 'up', mode: 'test' }),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };
}

export interface TestAppOptions {
  metadata: ModuleMetadata;
  prisma?: PrismaMock;
  redis?: ReturnType<typeof createRedisMock>;
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

export async function createTestApp(options: TestAppOptions): Promise<{
  app: INestApplication;
  prisma: PrismaMock;
  redis: ReturnType<typeof createRedisMock>;
}> {
  const prisma = options.prisma ?? createPrismaMock();
  const redis = options.redis ?? createRedisMock();

  // Khai báo sẵn hai provider này trong module test rồi override, vì
  // overrideProvider chỉ thay được thứ đã tồn tại trong graph.
  let builder = Test.createTestingModule({
    ...options.metadata,
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: RedisService, useValue: redis },
      ...(options.metadata.providers ?? []),
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(RedisService)
    .useValue(redis);

  if (options.configure) {
    builder = options.configure(builder);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();

  // Khớp với cấu hình trong src/main.ts để e2e phản ánh hành vi thật.
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();
  return { app, prisma, redis };
}
