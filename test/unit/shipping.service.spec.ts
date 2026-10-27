import { BadRequestException, ConflictException } from '@nestjs/common';
import { GhnAddressModel } from '@prisma/client';
import { ShippingService } from '../../src/modules/shipping/shipping.service';

const addressModel = GhnAddressModel.POST_MERGER_2_LEVEL;

function createService() {
  const prisma = {
    ghnCatalogMetadata: { findUnique: jest.fn() },
    ghnCatalogPublication: { findUnique: jest.fn() },
    ghnLocation: { findMany: jest.fn(), findFirst: jest.fn() },
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

function createShipmentService(pickupSettings: Record<string, string | null>) {
  const provider = { createShipment: jest.fn().mockResolvedValue({ providerOrderCode: 'GHN1' }) };
  const factory = { get: jest.fn().mockReturnValue(provider) };
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        GHN_FROM_NAME: 'FashionAI',
        GHN_FROM_PHONE: '0901234567',
        GHN_FROM_ADDRESS_LINE: '',
      };
      return values[key];
    }),
  };
  const adminSettingsService = {
    getGhnPickupSettings: jest.fn().mockResolvedValue(pickupSettings),
  };
  const service = new ShippingService(
    config as any,
    {} as any,
    factory as any,
    {} as any,
    adminSettingsService as any,
  );
  return { service, provider, factory };
}

describe('ShippingService pickup sender', () => {
  it('luôn gửi sender 2 cấp đã cấu hình khi tạo vận đơn', async () => {
    const { service, provider } = createShipmentService({
      provinceV3Id: '1000001',
      provinceName: 'Hồ Chí Minh',
      wardV3Id: '1003575',
      wardName: 'Phường Long Bình',
      addressLine: 'Long Thạnh Mỹ',
    });

    await service.createShipment({} as any);

    expect(provider.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: {
          name: 'FashionAI',
          phone: '0901234567',
          address: 'Long Thạnh Mỹ, Phường Long Bình, Hồ Chí Minh',
          provinceId: '1000001',
          wardId: '1003575',
          provinceName: 'Hồ Chí Minh',
          wardName: 'Phường Long Bình',
        },
      }),
      undefined,
    );
  });

  it('chặn tạo vận đơn khi thiếu số nhà/tên đường lấy hàng', async () => {
    const { service, provider } = createShipmentService({
      provinceV3Id: '1000001',
      provinceName: 'Hồ Chí Minh',
      wardV3Id: '1003575',
      wardName: 'Phường Long Bình',
      addressLine: '',
    });

    await expect(service.createShipment({} as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createShipment({} as any)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ADDRESS_INVALID' }),
    });
    expect(provider.createShipment).not.toHaveBeenCalled();
  });
});

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

  it('validate địa chỉ V3 chỉ trả field lưu được vào UserAddress', async () => {
    const { service, prisma } = createService();
    prisma.ghnCatalogMetadata.findUnique.mockResolvedValue({
      addressModel,
      publishedGeneration: BigInt(5),
      catalogRevision: BigInt(3),
    });
    prisma.ghnLocation.findFirst
      .mockResolvedValueOnce({ code: '1000001', name: 'Hồ Chí Minh' })
      .mockResolvedValueOnce({ code: '1003575', name: 'Phường Long Bình' });

    const result = await service.validateGhnLocation('1000001', '1003575');

    expect(result).toEqual({
      ghnProvinceV3Id: '1000001',
      ghnWardV3Id: '1003575',
      provinceName: 'Hồ Chí Minh',
      wardName: 'Phường Long Bình',
    });
    expect(result).not.toHaveProperty('ghnAddressModel');
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
