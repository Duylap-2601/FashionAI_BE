import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GarmentCategory,
  LiveTryOnCredentialStatus,
  LiveTryOnReservationStatus,
  LiveTryOnSessionStatus,
  ProductStatus,
  Role,
  UserTier,
} from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service';
import { AuthenticatedUser } from '../../src/modules/auth/interfaces/authenticated-user.interface';
import { DecartRealtimeService } from '../../src/modules/try-on/decart-realtime.service';
import { LiveTryOnService } from '../../src/modules/try-on/live-try-on.service';

type MockTx = {
  liveTryOnLease: { count: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock };
  liveTryOnBudget: { upsert: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  liveTryOnSession: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
};

type MockPrisma = {
  liveTryOnBudget: { findUnique: jest.Mock };
  liveTryOnLease: { findUnique: jest.Mock };
  liveTryOnSession: { findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock };
  product: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};

type MockDecart = {
  model: string;
  getTokenTtlSeconds: jest.Mock;
  createClientToken: jest.Mock;
};

describe('LiveTryOnService', () => {
  const user: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'member@example.com',
    name: null,
    avatarUrl: null,
    tier: UserTier.MEMBER,
    tierExpiresAt: null,
    role: Role.USER,
    isVerified: true,
    jti: 'jti',
    exp: 9999999999,
  };

  const product = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Linen blazer',
    color: 'cream',
    material: 'linen',
    garmentUrl: 'https://cdn.example.com/blazer.png',
    status: ProductStatus.ACTIVE,
    category: GarmentCategory.UPPER,
  };

  let config: { get: jest.Mock };
  let prisma: MockPrisma;
  let decart: MockDecart;
  let tx: MockTx;
  let service: LiveTryOnService;

  beforeEach(() => {
    jest.clearAllMocks();
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          DECART_LIVE_TRYON_ENABLED: 'true',
          DECART_LIVE_MAX_DURATION_SECONDS: '60',
          DECART_LIVE_GRACE_SECONDS: '30',
          DECART_LIVE_USER_DAILY_SECONDS: '300',
          DECART_LIVE_GLOBAL_DAILY_CREDITS: '12000',
          DECART_LIVE_MAX_CONCURRENT_SESSIONS: '2',
          DECART_LIVE_RATE_CREDITS_PER_SECOND: '2',
          DECART_LIVE_POLICY_VERSION: 'test-v1',
          DECART_LIVE_ALLOWED_CATEGORIES: 'UPPER',
          DECART_LIVE_DB_RETRY_ATTEMPTS: '1',
        };
        return values[key];
      }),
    };
    decart = {
      model: 'lucy-vton-3.5',
      getTokenTtlSeconds: jest.fn(() => 120),
      createClientToken: jest.fn().mockResolvedValue({
        clientToken: 'client-token',
        tokenExpiresAt: new Date('2026-01-01T00:02:00.000Z'),
        raw: { requestId: 'req-1' },
      }),
    };
    tx = {
      liveTryOnLease: {
        count: jest.fn().mockResolvedValue(0),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      liveTryOnBudget: {
        upsert: jest.fn()
          .mockResolvedValueOnce({ id: 'user-budget', reservedSeconds: 0, allocatedSeconds: 0 })
          .mockResolvedValueOnce({ id: 'global-budget', reservedSeconds: 0, allocatedSeconds: 0 }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      liveTryOnSession: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'session-1', ...data })),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
      },
    };
    prisma = {
      liveTryOnBudget: { findUnique: jest.fn() },
      liveTryOnLease: { findUnique: jest.fn() },
      liveTryOnSession: {
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'session-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      product: { findUnique: jest.fn().mockResolvedValue(product) },
      $transaction: jest.fn((fn: (client: MockTx) => Promise<unknown>) => fn(tx)),
    };
    service = new LiveTryOnService(
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
      decart as unknown as DecartRealtimeService,
    );
  });

  it('returns disabled quota without using image quota semantics', async () => {
    config.get.mockImplementation((key: string) => key === 'DECART_LIVE_TRYON_ENABLED' ? 'false' : undefined);
    const quota = await service.getQuota(user);
    expect(quota.enabled).toBe(false);
    expect(quota.unit).toBe('seconds');
    expect(quota.remaining).toBe(0);
  });

  it('creates a direct session once and reserves user/global budgets plus a lease', async () => {
    const result = await service.createSession(
      user,
      { productId: product.id },
      '33333333-3333-4333-8333-333333333333',
      'http://localhost:3000',
    );

    expect(result.connection.clientToken).toBe('client-token');
    expect(tx.liveTryOnBudget.update).toHaveBeenCalledTimes(2);
    expect(tx.liveTryOnLease.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: user.id } }));
    expect(decart.createClientToken).toHaveBeenCalledWith({ origin: 'http://localhost:3000', maxDurationSeconds: 60 });
  });

  it('rejects reused idempotency keys without minting a second credential', async () => {
    prisma.liveTryOnSession.findUnique.mockResolvedValue({
      id: 'session-1',
      idempotencyBodyHash: 'different',
      credentialStatus: LiveTryOnCredentialStatus.ISSUED,
      blockedUntil: new Date('2026-01-01T00:05:00.000Z'),
    });

    await expect(service.createSession(user, { productId: product.id }, '33333333-3333-4333-8333-333333333333')).rejects.toMatchObject({ status: 409 });
    expect(decart.createClientToken).not.toHaveBeenCalled();
  });

  it('fails closed when concurrency slots are exhausted', async () => {
    tx.liveTryOnLease.count.mockResolvedValue(2);
    await expect(service.createSession(user, { productId: product.id }, '33333333-3333-4333-8333-333333333333')).rejects.toBeInstanceOf(ForbiddenException);
    expect(decart.createClientToken).not.toHaveBeenCalled();
  });

  it('releases reserved budgets and lease when token issuance fails', async () => {
    decart.createClientToken.mockRejectedValue(new Error('provider down'));
    await expect(service.createSession(user, { productId: product.id }, '33333333-3333-4333-8333-333333333333')).rejects.toThrow('provider down');
    expect(tx.liveTryOnBudget.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { scopeKey: 'global', date: expect.any(String) } }));
    expect(tx.liveTryOnLease.deleteMany).toHaveBeenCalledWith({ where: { userId: user.id, sessionId: 'session-1' } });
  });

  it('settles expired reserved sessions conservatively through the worker', async () => {
    const expired = {
      id: 'session-1',
      userId: user.id,
      status: LiveTryOnSessionStatus.ACTIVE,
      credentialStatus: LiveTryOnCredentialStatus.ISSUING,
      reservationStatus: LiveTryOnReservationStatus.RESERVED,
      quotaDate: '2026-01-01',
      reservedSeconds: 60,
      blockedUntil: new Date(Date.now() - 1000),
    };
    prisma.liveTryOnSession.findMany.mockResolvedValue([expired]);
    tx.liveTryOnSession.findUnique.mockResolvedValue(expired);

    await service.reconcileExpiredSessions();

    expect(tx.liveTryOnSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-1' },
      data: expect.objectContaining({
        status: LiveTryOnSessionStatus.EXPIRED,
        credentialStatus: LiveTryOnCredentialStatus.ISSUE_UNKNOWN,
        reservationStatus: LiveTryOnReservationStatus.ALLOCATED,
        allocatedSeconds: 60,
      }),
    }));
    expect(tx.liveTryOnLease.deleteMany).toHaveBeenCalledWith({ where: { userId: user.id, sessionId: 'session-1' } });
  });
});
