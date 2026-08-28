import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

export type PrismaMock = any;
export type RedisMock = any;

export function createPrismaMock(): PrismaMock {
  return {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    subscription: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    order: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    product: {
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    payment: {
      create: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback({
      user: { findUnique: jest.fn(), update: jest.fn() },
      subscription: { create: jest.fn(), updateMany: jest.fn() },
      order: { updateMany: jest.fn() },
      product: { update: jest.fn() },
      payment: { create: jest.fn() },
    })),
  };
}

export function createRedisMock(): RedisMock {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
    incr: jest.fn(),
  };
}

interface CreateTestAppOptions {
  prisma?: PrismaMock;
  redis?: RedisMock;
  metadata?: any;
  configure?: (builder: any) => any;
}

export async function createTestApp(
  options: CreateTestAppOptions,
): Promise<{ app: INestApplication }> {
  const { prisma, redis, metadata = {}, configure } = options;

  const moduleBuilder = Test.createTestingModule({
    imports: metadata.imports || [],
    controllers: metadata.controllers || [],
    providers: [
      ...(metadata.providers || []),
      ...(prisma ? [{ provide: 'PrismaService', useValue: prisma }] : []),
      ...(redis ? [{ provide: 'RedisService', useValue: redis }] : []),
    ],
  });

  let module = moduleBuilder;
  if (configure) {
    module = configure(moduleBuilder);
  }

  const compiled: TestingModule = await module.compile();
  const app = compiled.createNestApplication();
  await app.init();

  return { app };
}
