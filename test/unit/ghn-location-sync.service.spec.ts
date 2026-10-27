import { GhnAddressModel, Prisma } from '@prisma/client';
import { GhnLocationSyncService } from '../../src/modules/shipping/ghn-location-sync.service';

const addressModel = GhnAddressModel.POST_MERGER_2_LEVEL;

function createService(previousRevision = BigInt(2), latestRunGeneration: bigint | null = null) {
  const prisma: any = {
    ghnCatalogMetadata: {
      findUnique: jest.fn().mockResolvedValue({
        addressModel,
        publishedGeneration: BigInt(4),
        catalogRevision: previousRevision,
      }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    ghnCatalogPublication: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
    },
    ghnLocationSyncRun: {
      findFirst: jest.fn().mockResolvedValue(latestRunGeneration === null ? null : { catalogGeneration: latestRunGeneration }),
      create: jest.fn().mockResolvedValue({ id: 'sync-run-1' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ghnLocation: {
      upsert: jest.fn().mockImplementation((args) => Promise.resolve(args)),
    },
    $transaction: jest.fn((arg: unknown) => {
      if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(prisma);
      return Promise.all(arg as Promise<unknown>[]);
    }),
  };

  const ghnClient = {
    get: jest.fn().mockImplementation((path: string) => {
      if (path.includes('province')) {
        return Promise.resolve({ data: [{ _id: '79', name: 'Thành phố Hồ Chí Minh' }] });
      }
      return Promise.resolve({ data: [{ _id: '26734', name: 'Phường Bến Nghé', province_id: '79' }] });
    }),
  };

  const redis = {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  };

  const service = new GhnLocationSyncService(prisma, ghnClient as any, redis as any);
  return { service, prisma, redis };
}

describe('GhnLocationSyncService', () => {
  it('gia hạn revision cũ từ lúc bị thay thế và tạo revision active mới', async () => {
    const { service, prisma, redis } = createService();

    const result = await service.sync('admin');

    expect(result).toEqual({ skipped: false, generation: '5', counts: { provinces: 1, wards: 1 } });
    expect(prisma.ghnCatalogPublication.updateMany).toHaveBeenCalledWith({
      where: { addressModel, catalogRevision: BigInt(2) },
      data: { retainedUntil: expect.any(Date) },
    });
    expect(prisma.ghnCatalogPublication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        addressModel,
        catalogGeneration: BigInt(5),
        catalogRevision: BigInt(3),
        retainedUntil: expect.any(Date),
      }),
    });

    const updateArgs = prisma.ghnCatalogPublication.updateMany.mock.calls[0][0];
    const createArgs = prisma.ghnCatalogPublication.create.mock.calls[0][0];
    expect(updateArgs.data.retainedUntil.getTime()).toBe(createArgs.data.retainedUntil.getTime());
    expect(createArgs.data.retainedUntil.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    expect(redis.releaseLock).toHaveBeenCalledWith('ghn:location-sync');
  });

  it('cấp generation mới khi lần sync trước thất bại đã chiếm generation', async () => {
    const { service, prisma } = createService(BigInt(2), BigInt(5));

    const result = await service.sync('admin');

    expect(result).toEqual({ skipped: false, generation: '6', counts: { provinces: 1, wards: 1 } });
    expect(prisma.ghnLocationSyncRun.create).toHaveBeenCalledWith({
      data: { addressModel, catalogGeneration: BigInt(6), status: 'RUNNING' },
    });
    expect(prisma.ghnCatalogPublication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ catalogGeneration: BigInt(6) }),
    });
  });

  it('thử cấp generation khác khi tạo sync run bị trùng', async () => {
    const { service, prisma } = createService();
    prisma.ghnLocationSyncRun.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ catalogGeneration: BigInt(5) });
    prisma.ghnLocationSyncRun.create
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      )
      .mockResolvedValueOnce({ id: 'sync-run-2' });

    const result = await service.sync('admin');

    expect(result).toEqual({ skipped: false, generation: '6', counts: { provinces: 1, wards: 1 } });
    expect(prisma.ghnLocationSyncRun.create).toHaveBeenNthCalledWith(1, {
      data: { addressModel, catalogGeneration: BigInt(5), status: 'RUNNING' },
    });
    expect(prisma.ghnLocationSyncRun.create).toHaveBeenNthCalledWith(2, {
      data: { addressModel, catalogGeneration: BigInt(6), status: 'RUNNING' },
    });
  });

  it('luôn giải phóng lock khi không cấp được generation', async () => {
    const { service, prisma, redis } = createService();
    prisma.ghnLocationSyncRun.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );

    await expect(service.sync('admin')).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(prisma.ghnLocationSyncRun.update).not.toHaveBeenCalled();
    expect(redis.releaseLock).toHaveBeenCalledWith('ghn:location-sync');
  });

  it('bỏ qua khi sync khác đang chạy', async () => {
    const { service, prisma, redis } = createService();
    redis.acquireLock.mockResolvedValue(false);

    await expect(service.sync('cron')).resolves.toEqual({ skipped: true, reason: 'already_running' });
    expect(prisma.ghnLocationSyncRun.create).not.toHaveBeenCalled();
  });
});
