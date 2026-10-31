import { SalePricingService, resolveSalePrice } from '../../src/modules/sale-campaigns/sale-pricing.service';
import { PrismaService } from '../../src/database/prisma.service';

function campaignRow(
  productId: string,
  campaign: {
    id: string;
    name?: string;
    discountPercent: number;
    startsAt?: Date | null;
    endsAt?: Date | null;
  },
) {
  return {
    productId,
    campaign: {
      name: campaign.name ?? campaign.id,
      startsAt: campaign.startsAt ?? null,
      endsAt: campaign.endsAt ?? null,
      ...campaign,
    },
  };
}

describe('SalePricingService', () => {
  let service: SalePricingService;
  let prisma: { saleCampaignItem: { findMany: jest.Mock } };

  beforeEach(() => {
    prisma = { saleCampaignItem: { findMany: jest.fn().mockResolvedValue([]) } };
    service = new SalePricingService(prisma as unknown as PrismaService);
  });

  it('làm tròn giá sale theo đơn giá', () => {
    expect(resolveSalePrice(999_999, 30)).toBe(699_999);
    expect(resolveSalePrice(1_000_000, 30)).toBe(700_000);
    expect(resolveSalePrice(800_000, 6.25)).toBe(750_000);
  });

  it('trả map rỗng và không query khi không có sản phẩm', async () => {
    const result = await service.resolveSaleForProducts([]);
    expect(result.size).toBe(0);
    expect(prisma.saleCampaignItem.findMany).not.toHaveBeenCalled();
  });

  it('chọn giá sale thấp nhất khi một sản phẩm trúng nhiều campaign', async () => {
    prisma.saleCampaignItem.findMany.mockResolvedValue([
      campaignRow('p1', { id: 'campaign-a', discountPercent: 10 }),
      campaignRow('p1', { id: 'campaign-b', discountPercent: 30 }),
    ]);

    const result = await service.resolveSaleForProducts([{ id: 'p1', price: 1_000_000 }]);

    expect(result.get('p1')).toMatchObject({
      campaignId: 'campaign-b',
      percent: 30,
      salePrice: 700_000,
    });
  });

  it('hoà giá sale thì chọn endsAt sớm hơn, rồi id nhỏ hơn', async () => {
    prisma.saleCampaignItem.findMany.mockResolvedValue([
      campaignRow('p1', {
        id: 'campaign-z',
        discountPercent: 30,
        endsAt: new Date('2026-12-01T00:00:00.000Z'),
      }),
      campaignRow('p1', {
        id: 'campaign-b',
        discountPercent: 30,
        endsAt: new Date('2026-11-01T00:00:00.000Z'),
      }),
      campaignRow('p1', {
        id: 'campaign-a',
        discountPercent: 30,
        endsAt: new Date('2026-11-01T00:00:00.000Z'),
      }),
    ]);

    const result = await service.resolveSaleForProducts([{ id: 'p1', price: 1_000_000 }]);

    expect(result.get('p1')?.campaignId).toBe('campaign-a');
  });

  it('chỉ trả các sản phẩm đang sale và giữ đúng giá niêm yết từng sản phẩm', async () => {
    prisma.saleCampaignItem.findMany.mockResolvedValue([
      campaignRow('p1', { id: 'campaign-a', discountPercent: 20 }),
      campaignRow('p2', { id: 'campaign-b', discountPercent: 50 }),
    ]);

    const result = await service.resolveSaleForProducts([
      { id: 'p1', price: 500_000 },
      { id: 'p2', price: 300_000 },
      { id: 'p3', price: 100_000 },
    ]);

    expect(result.get('p1')?.salePrice).toBe(400_000);
    expect(result.get('p2')?.salePrice).toBe(150_000);
    expect(result.has('p3')).toBe(false);
  });
});
