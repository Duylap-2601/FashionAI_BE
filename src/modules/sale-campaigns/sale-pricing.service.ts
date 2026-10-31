import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export type ActiveSale = {
  campaignId: string;
  campaignName: string;
  percent: number;
  salePrice: number;
};

type PricedProduct = { id: string; price: Prisma.Decimal | number };

type SaleCandidate = ActiveSale & {
  startsAt: Date | null;
  endsAt: Date | null;
};

export function resolveSalePrice(listPrice: number, percent: number) {
  return Math.round((listPrice * (100 - percent)) / 100);
}

@Injectable()
export class SalePricingService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveSaleForProducts(
    products: PricedProduct[],
    at: Date = new Date(),
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Map<string, ActiveSale>> {
    const uniqueProducts = new Map<string, PricedProduct>();
    for (const product of products) {
      if (!uniqueProducts.has(product.id)) uniqueProducts.set(product.id, product);
    }

    const ids = [...uniqueProducts.keys()];
    const result = new Map<string, ActiveSale>();
    if (ids.length === 0) return result;

    const rows = await db.saleCampaignItem.findMany({
      where: {
        productId: { in: ids },
        campaign: {
          isActive: true,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: at } }] },
            { OR: [{ endsAt: null }, { endsAt: { gt: at } }] },
          ],
        },
      },
      select: {
        productId: true,
        campaign: {
          select: {
            id: true,
            name: true,
            discountPercent: true,
            startsAt: true,
            endsAt: true,
          },
        },
      },
    });

    const bestByProduct = new Map<string, SaleCandidate>();
    for (const row of rows) {
      const product = uniqueProducts.get(row.productId);
      if (!product) continue;

      const percent = Number(row.campaign.discountPercent);
      if (!(percent > 0 && percent < 100)) continue;

      const listPrice = Number(product.price);
      const candidate: SaleCandidate = {
        campaignId: row.campaign.id,
        campaignName: row.campaign.name,
        percent,
        salePrice: resolveSalePrice(listPrice, percent),
        startsAt: row.campaign.startsAt,
        endsAt: row.campaign.endsAt,
      };

      const current = bestByProduct.get(row.productId);
      if (!current || isBetterSale(candidate, current)) {
        bestByProduct.set(row.productId, candidate);
      }
    }

    for (const [productId, candidate] of bestByProduct) {
      result.set(productId, {
        campaignId: candidate.campaignId,
        campaignName: candidate.campaignName,
        percent: candidate.percent,
        salePrice: candidate.salePrice,
      });
    }

    return result;
  }
}

function isBetterSale(next: SaleCandidate, current: SaleCandidate) {
  if (next.salePrice !== current.salePrice) return next.salePrice < current.salePrice;
  const nextEnds = next.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const currentEnds = current.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (nextEnds !== currentEnds) return nextEnds < currentEnds;
  return next.campaignId < current.campaignId;
}
