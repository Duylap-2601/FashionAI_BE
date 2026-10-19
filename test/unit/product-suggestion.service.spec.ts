import { ProductSuggestionService } from '../../src/modules/products/product-suggestion.service';
import { PrismaService } from '../../src/database/prisma.service';

describe('ProductSuggestionService', () => {
  let service: ProductSuggestionService;
  let prisma: any;

  const catalogRows = [
    { id: 'shirt-1', name: 'Áo Sơ Mi Basic ', category: 'UPPER', garmentType: 'SHIRT', color: 'trắng', colors: [{ name: 'Trắng', hex: '#fff' }], material: 'kate', price: '550000' },
    { id: 'pants-1', name: 'Quần Tây Ống Suông', category: 'LOWER', garmentType: 'PANTS', color: 'be', colors: [], material: null, price: '550000' },
    { id: 'blazer-1', name: 'Áo Blazer Đen', category: 'UPPER', garmentType: 'JACKET', color: 'đen', colors: null, material: 'kaki', price: '750000' },
    { id: 'dress-1', name: 'Đầm Trên Gối', category: 'FULL_BODY', garmentType: 'DRESS', color: 'đen', colors: [{ name: 'Đen' }], material: null, price: '750000' },
  ];

  beforeEach(() => {
    prisma = { product: { findMany: jest.fn().mockResolvedValue(catalogRows) } };
    service = new ProductSuggestionService(prisma as PrismaService, { get: () => undefined } as any);
  });

  it('getCatalog gán mã ngắn theo thứ tự, chỉ lấy sản phẩm ACTIVE và cache trong thời gian ngắn', async () => {
    const catalog = await service.getCatalog();

    expect(catalog.entries.map((e) => e.code)).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(catalog.audienceNote).toContain('thời trang NỮ');
    expect(catalog.entries[0]).toMatchObject({ name: 'Áo Sơ Mi Basic', colors: ['Trắng'], price: 550000 });
    // Không khai báo colors thì dùng field color làm màu hiển thị cho AI.
    expect(catalog.entries[1].colors).toEqual(['be']);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' } }),
    );

    await service.getCatalog();
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
  });

  it('formatCatalogForPrompt ghi mã, tên, loại, màu, chất liệu và giá', async () => {
    const text = service.formatCatalogForPrompt(await service.getCatalog());
    expect(text.split('\n')[0]).toBe('P1 | Áo Sơ Mi Basic | Áo sơ mi/áo kiểu | màu: Trắng | chất liệu: kate | 550.000đ');
  });

  it('resolveOutfits bỏ mã bịa, bỏ trùng, chuẩn hóa mã và loại bộ chỉ có một món không phải đầm', async () => {
    const catalog = await service.getCatalog();
    const outfits = service.resolveOutfits(
      [
        { name: 'Công sở', reason: 'Lịch sự', items: [{ code: 'p1', note: 'sơ vin' }, { code: 'P99' }, '2', { code: 'P1' }], extras: ['Giày', 3] },
        { name: 'Chỉ một áo', items: [{ code: 'P1' }] },
        { name: 'Đầm', items: [{ code: 'P4' }] },
        { name: 'Toàn mã bịa', items: [{ code: 'P50' }, { code: 'P51' }] },
        'không phải object',
      ],
      catalog,
    );

    expect(outfits).toEqual([
      {
        name: 'Công sở',
        reason: 'Lịch sự',
        items: [
          { productId: 'shirt-1', note: 'sơ vin' },
          { productId: 'pants-1', note: null },
        ],
        extras: ['Giày'],
      },
      { name: 'Đầm', reason: '', items: [{ productId: 'dress-1', note: null }], extras: [] },
    ]);
  });

  it('resolveOutfits loại bộ không chứa sản phẩm người dùng đang cân nhắc', async () => {
    const catalog = await service.getCatalog();
    const outfits = service.resolveOutfits(
      [
        { name: 'Có blazer', items: [{ code: 'P1' }, { code: 'P2' }, { code: 'P3' }] },
        { name: 'Không blazer', items: [{ code: 'P1' }, { code: 'P2' }] },
      ],
      catalog,
      { anchorProductId: 'blazer-1' },
    );
    expect(outfits.map((o) => o.name)).toEqual(['Có blazer']);
  });

  it('resolveProductCodes bỏ mã không hợp lệ và trùng', async () => {
    const catalog = await service.getCatalog();
    expect(service.resolveProductCodes(['P3', 'P3', 'P77', { code: 'P1' }, null], catalog)).toEqual([
      'blazer-1',
      'shirt-1',
    ]);
  });

  it('buildOutfits sắp xếp theo vai trò, bỏ món đã xóa và không tính món ngừng bán vào tổng giá', () => {
    const products = new Map<string, any>([
      ['shirt-1', { id: 'shirt-1', name: 'Áo', price: 550000, image: null, color: 'Trắng', garmentType: 'SHIRT', category: 'UPPER', available: true }],
      ['pants-1', { id: 'pants-1', name: 'Quần', price: 550000, image: null, color: null, garmentType: 'PANTS', category: 'LOWER', available: false }],
      ['blazer-1', { id: 'blazer-1', name: 'Blazer', price: 750000, image: null, color: null, garmentType: 'JACKET', category: 'UPPER', available: true }],
    ]);

    const [outfit] = service.buildOutfits(
      [
        {
          name: 'Bộ 1',
          reason: '',
          items: [
            { productId: 'pants-1', note: null },
            { productId: 'deleted', note: null },
            { productId: 'shirt-1', note: 'sơ vin' },
            { productId: 'blazer-1', note: null },
          ],
          extras: [],
        },
      ],
      products,
    );

    expect(outfit.items.map((i) => i.role)).toEqual(['outer', 'top', 'bottom']);
    expect(outfit.totalPrice).toBe(1300000);
  });

  it('loadProducts lấy ảnh chính và màu đầu tiên trong danh sách màu', async () => {
    prisma.product.findMany.mockResolvedValueOnce([
      {
        id: 'shirt-1',
        name: 'Áo ',
        price: '550000',
        garmentUrl: 'https://cdn/garment.png',
        images: [{ imageUrl: 'https://cdn/a.png', isMain: false }, { imageUrl: 'https://cdn/main.png', isMain: true }],
        colors: [{ name: 'Trắng' }, { name: 'Đen' }],
        garmentType: 'SHIRT',
        category: 'UPPER',
        status: 'ARCHIVED',
      },
    ]);

    const products = await service.loadProducts(['shirt-1', 'shirt-1']);
    expect(products.get('shirt-1')).toEqual({
      id: 'shirt-1',
      name: 'Áo',
      price: 550000,
      image: 'https://cdn/main.png',
      color: 'Trắng',
      garmentType: 'SHIRT',
      category: 'UPPER',
      available: false,
    });
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['shirt-1'] } },
      include: { images: true },
    });
  });
});
