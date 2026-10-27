import { GarmentCategory } from '@prisma/client';
import { ProductsService } from '../../src/modules/products/products.service';
import { PrismaService } from '../../src/database/prisma.service';
import { StorageService } from '../../src/modules/storage/storage.service';

describe('ProductsService originalPrice', () => {
  let service: ProductsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      product: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new ProductsService(
      prisma as PrismaService,
      {} as StorageService,
    );
  });

  it('create chặn originalPrice nhỏ hơn price', async () => {
    await expect(
      service.create({
        name: 'Áo sơ mi',
        category: GarmentCategory.UPPER,
        price: 500000,
        originalPrice: 450000,
        garmentUrl: 'https://cdn.test/shirt.png',
      } as any),
    ).rejects.toThrow('originalPrice');
  });

  it('update chặn khi giá mới vượt quá originalPrice hiện tại', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'product-1',
      price: 1000000,
      originalPrice: 1200000,
    });

    await expect(
      service.update('product-1', { price: 1300000 }),
    ).rejects.toThrow('originalPrice');
  });

  it('update cho phép khi originalPrice vẫn lớn hơn hoặc bằng price', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'product-1',
      price: 1000000,
      originalPrice: 1200000,
    });
    prisma.product.update.mockResolvedValue({ id: 'product-1' });

    await expect(
      service.update('product-1', { price: 1100000 }),
    ).resolves.toEqual({ id: 'product-1' });
  });
});
