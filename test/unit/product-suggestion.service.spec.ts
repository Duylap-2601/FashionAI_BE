import { ProductSuggestionService, toCatalogAudience } from '../../src/modules/products/product-suggestion.service';
import { PrismaService } from '../../src/database/prisma.service';

describe('ProductSuggestionService', () => {
  let service: ProductSuggestionService;
  let prisma: any;

  const catalogRows = [
    { id: 'shirt-1', name: 'Áo Sơ Mi Basic ', category: 'UPPER', garmentType: 'SHIRT', gender: 'FEMALE', color: 'trắng', colors: [{ name: 'Trắng', hex: '#fff' }], material: 'kate', price: '550000' },
    { id: 'pants-1', name: 'Quần Tây Ống Suông', category: 'LOWER', garmentType: 'PANTS', gender: 'FEMALE', color: 'be', colors: [], material: null, price: '550000' },
    { id: 'blazer-1', name: 'Áo Blazer Đen', category: 'UPPER', garmentType: 'JACKET', gender: 'FEMALE', color: 'đen', colors: null, material: 'kaki', price: '750000' },
    { id: 'dress-1', name: 'Đầm Trên Gối', category: 'FULL_BODY', garmentType: 'DRESS', gender: 'FEMALE', color: 'đen', colors: [{ name: 'Đen' }], material: null, price: '750000' },
  ];

  beforeEach(() => {
    prisma = { product: { findMany: jest.fn().mockResolvedValue(catalogRows) } };
    service = new ProductSuggestionService(prisma as PrismaService);
  });

  it('getCatalog gán mã ngắn theo thứ tự, chỉ lấy sản phẩm ACTIVE và cache trong thời gian ngắn', async () => {
    const catalog = await service.getCatalog();

    expect(catalog.entries.map((e) => e.code)).toEqual(['P1', 'P2', 'P3', 'P4']);
    // Catalog chỉ có đồ nữ thì AI phải biết cửa hàng chưa bán đồ nam.
    expect(catalog.audienceNote).toContain('Cửa hàng hiện chưa bán đồ nam.');
    expect(catalog.audienceNote).not.toContain('chưa bán đồ nữ');
    expect(catalog.entries[0]).toMatchObject({ name: 'Áo Sơ Mi Basic', colors: ['Trắng'], price: 550000 });
    // Không khai báo colors thì dùng field color làm màu hiển thị cho AI.
    expect(catalog.entries[1].colors).toEqual(['be']);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' } }),
    );

    await service.getCatalog();
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
  });

  it('formatCatalogForPrompt ghi mã, tên, loại, lớp, giới tính, màu, chất liệu và giá', async () => {
    const text = service.formatCatalogForPrompt(await service.getCatalog());
    expect(text.split('\n')[0]).toBe(
      'P1 | Áo Sơ Mi Basic | Áo sơ mi/áo kiểu | lớp: Mặc trong | giới tính: Nữ | màu: Trắng | chất liệu: kate | 550.000đ',
    );
  });

  describe('lọc theo giới tính', () => {
    const mixedRows = [
      ...catalogRows,
      { id: 'men-shirt-1', name: 'Áo Sơ Mi Nam', category: 'UPPER', garmentType: 'SHIRT', gender: 'MALE', color: 'xanh', colors: [], material: null, price: '600000' },
      { id: 'tee-1', name: 'Áo Thun Unisex', category: 'UPPER', garmentType: 'SHIRT', gender: 'UNISEX', color: 'trắng', colors: [], material: null, price: '300000' },
    ];

    it('getCatalog(MALE) chỉ giữ đồ nam và unisex, đánh lại mã từ P1 và dùng chung một lần đọc DB', async () => {
      prisma.product.findMany.mockResolvedValue(mixedRows);

      const all = await service.getCatalog();
      const men = await service.getCatalog('MALE');
      const women = await service.getCatalog('FEMALE');

      expect(all.entries).toHaveLength(6);
      expect(all.audienceNote).not.toContain('chưa bán');
      expect(men.entries.map((e) => [e.code, e.id])).toEqual([
        ['P1', 'men-shirt-1'],
        ['P2', 'tee-1'],
      ]);
      expect(men.byCode.get('P1')?.id).toBe('men-shirt-1');
      expect(men.audienceNote).toContain('chỉ gồm đồ nam và đồ unisex');
      expect(men.audienceNote).not.toContain('chưa bán');
      expect(women.entries.map((e) => e.id)).toEqual(['shirt-1', 'pants-1', 'blazer-1', 'dress-1', 'tee-1']);
      expect(new Set([all.fingerprint, men.fingerprint, women.fingerprint]).size).toBe(3);
      expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    });

    it('getCatalog(MALE) khi chưa có đồ nam: danh mục rỗng và nói rõ cửa hàng chưa bán đồ nam', async () => {
      const men = await service.getCatalog('MALE');

      expect(men.entries).toEqual([]);
      expect(men.audienceNote).toContain('Cửa hàng hiện chưa bán đồ nam.');
    });

    it('fingerprint đổi khi admin đổi giới tính của một sản phẩm', async () => {
      const before = await service.getCatalog();
      (service as any).cachedProducts = null;
      prisma.product.findMany.mockResolvedValue(catalogRows.map((row, i) => (i === 0 ? { ...row, gender: 'UNISEX' } : row)));
      const after = await service.getCatalog();

      expect(after.fingerprint).not.toBe(before.fingerprint);
    });

    it('toCatalogAudience đổi lựa chọn giới tính của Stylist sang giới tính lọc catalog', () => {
      expect(toCatalogAudience('male')).toBe('MALE');
      expect(toCatalogAudience(' Female ')).toBe('FEMALE');
      expect(toCatalogAudience('other')).toBeNull();
      expect(toCatalogAudience('')).toBeNull();
      expect(toCatalogAudience(undefined)).toBeNull();
    });
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
      ['shirt-1', { id: 'shirt-1', name: 'Áo', price: 550000, image: null, color: 'Trắng', garmentType: 'SHIRT', category: 'UPPER', layerRole: 'INNER', available: true }],
      ['pants-1', { id: 'pants-1', name: 'Quần', price: 550000, image: null, color: null, garmentType: 'PANTS', category: 'LOWER', layerRole: 'BOTTOM', available: false }],
      ['blazer-1', { id: 'blazer-1', name: 'Blazer', price: 750000, image: null, color: null, garmentType: 'JACKET', category: 'UPPER', layerRole: 'OUTER', available: true }],
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
      layerRole: 'INNER',
      available: false,
    });
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['shirt-1'] } },
      include: { images: true },
    });
  });
});
