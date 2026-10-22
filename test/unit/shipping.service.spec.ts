import { ConflictException } from '@nestjs/common';
import { GhnAddressModel } from '@prisma/client';
import { ShippingService } from '../../src/modules/shipping/shipping.service';

const addressModel = GhnAddressModel.POST_MERGER_2_LEVEL;

function createService() {
  const prisma = {
    ghnCatalogMetadata: { findUnique: jest.fn() },
    ghnCatalogPublication: { findUnique: jest.fn() },
    ghnLocation: { findMany: jest.fn() },
  };
  const service = new ShippingService(
    {} as any,
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, prisma };
}

function publication(revision: bigint, generation: bigint, retainedUntil: Date) {
  return {
    id: `publication-${revision}`,
    addressModel,
    catalogRevision: revision,
    catalogGeneration: generation,
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    retainedUntil,
  };
}

describe('ShippingService address catalog revision', () => {
  it('vẫn trả catalog cho revision đang active dù retainedUntil đã quá hạn', async () => {
    const { service, prisma } = createService();
    prisma.ghnCatalogMetadata.findUnique.mockResolvedValue({
      addressModel,
      publishedGeneration: BigInt(5),
      catalogRevision: BigInt(3),
    });
    prisma.ghnCatalogPublication.findUnique.mockResolvedValue(
      publication(BigInt(3), BigInt(5), new Date(Date.now() - 24 * 60 * 60 * 1000)),
    );
    prisma.ghnLocation.findMany.mockResolvedValue([
      { code: '79', name: 'Thành phố Hồ Chí Minh', aliases: ['HCM', 'Sài Gòn'] },
    ]);

    await expect(service.getAddressCatalogProvinces('3')).resolves.toEqual([
      {
        id: '79',
        name: 'Thành phố Hồ Chí Minh',
        aliases: ['HCM', 'Sài Gòn'],
        catalogRevision: '3',
      },
    ]);
  });

  it('trả catalog cho revision cũ còn trong thời gian lưu giữ', async () => {
    const { service, prisma } = createService();
    prisma.ghnCatalogMetadata.findUnique.mockResolvedValue({
      addressModel,
      publishedGeneration: BigInt(5),
      catalogRevision: BigInt(3),
    });
    prisma.ghnCatalogPublication.findUnique.mockResolvedValue(
      publication(BigInt(2), BigInt(4), new Date(Date.now() + 24 * 60 * 60 * 1000)),
    );
    prisma.ghnLocation.findMany.mockResolvedValue([
      { code: '26734', name: 'Phường Bến Nghé', aliases: [] },
    ]);

    await expect(service.getAddressCatalogWards('79', '2')).resolves.toEqual([
      {
        id: '26734',
        name: 'Phường Bến Nghé',
        aliases: [],
        catalogRevision: '2',
      },
    ]);
    expect(prisma.ghnLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          catalogGeneration: BigInt(4),
          parentCode: '79',
        }),
      }),
    );
  });

  it('chặn revision cũ đã hết thời gian lưu giữ', async () => {
    const { service, prisma } = createService();
    prisma.ghnCatalogMetadata.findUnique.mockResolvedValue({
      addressModel,
      publishedGeneration: BigInt(5),
      catalogRevision: BigInt(3),
    });
    prisma.ghnCatalogPublication.findUnique.mockResolvedValue(
      publication(BigInt(2), BigInt(4), new Date(Date.now() - 60 * 1000)),
    );

    const request = service.getAddressCatalogProvinces('2');
    await expect(request).rejects.toBeInstanceOf(ConflictException);
    await expect(request).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CATALOG_REVISION_STALE' }),
    });
    expect(prisma.ghnLocation.findMany).not.toHaveBeenCalled();
  });

  it('chặn revision không tồn tại', async () => {
    const { service, prisma } = createService();
    prisma.ghnCatalogMetadata.findUnique.mockResolvedValue({
      addressModel,
      publishedGeneration: BigInt(5),
      catalogRevision: BigInt(3),
    });
    prisma.ghnCatalogPublication.findUnique.mockResolvedValue(null);

    await expect(service.getAddressCatalogProvinces('99')).rejects.toBeInstanceOf(ConflictException);
  });
});
