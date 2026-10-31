import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CreateSaleCampaignDto } from './dto/create-sale-campaign.dto';
import { QuerySaleCampaignDto } from './dto/query-sale-campaign.dto';
import { UpdateSaleCampaignDto } from './dto/update-sale-campaign.dto';

const CAMPAIGN_INCLUDE = {
  _count: { select: { items: true } },
} satisfies Prisma.SaleCampaignInclude;

const CAMPAIGN_DETAIL_INCLUDE = {
  _count: { select: { items: true } },
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          price: true,
          status: true,
          garmentUrl: true,
          images: { select: { id: true, imageUrl: true, isMain: true, colorName: true } },
        },
      },
    },
  },
} satisfies Prisma.SaleCampaignInclude;

type CampaignWithCount = Prisma.SaleCampaignGetPayload<{ include: typeof CAMPAIGN_INCLUDE }>;
type CampaignWithDetail = Prisma.SaleCampaignGetPayload<{ include: typeof CAMPAIGN_DETAIL_INCLUDE }>;

type CampaignWindow = {
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

@Injectable()
export class SaleCampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSaleCampaignDto) {
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    this.assertWindow(startsAt, endsAt);

    if (dto.productIds.length === 0) {
      throw new BadRequestException('Chiến dịch sale phải có ít nhất một sản phẩm');
    }
    await this.assertProductsExist(dto.productIds);

    const isActive = dto.isActive ?? true;
    if (isActive) {
      await this.assertNoOverlap(dto.productIds, { isActive, startsAt, endsAt });
    }

    const campaign = await this.prisma.$transaction(async (tx) => {
      const created = await tx.saleCampaign.create({
        data: {
          name: dto.name.trim(),
          discountPercent: new Prisma.Decimal(dto.discountPercent),
          isActive,
          startsAt,
          endsAt,
          items: {
            create: dto.productIds.map((productId) => ({ productId })),
          },
        },
        include: CAMPAIGN_INCLUDE,
      });
      return created;
    });

    return this.toPublicCampaign(campaign);
  }

  async findAll(query: QuerySaleCampaignDto) {
    const { page = 1, limit = 20, isActive, search } = query;
    const skip = (page - 1) * limit;
    const where: Prisma.SaleCampaignWhereInput = {
      ...(isActive !== undefined ? { isActive } : {}),
      ...(search
        ? { name: { contains: search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.saleCampaign.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: CAMPAIGN_INCLUDE,
      }),
      this.prisma.saleCampaign.count({ where }),
    ]);

    return {
      items: items.map((campaign) => this.toPublicCampaign(campaign)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const campaign = await this.prisma.saleCampaign.findUnique({
      where: { id },
      include: CAMPAIGN_DETAIL_INCLUDE,
    });
    if (!campaign) {
      throw new NotFoundException(`Không tìm thấy chiến dịch sale có ID ${id}`);
    }
    return this.toPublicCampaignDetail(campaign);
  }

  async update(id: string, dto: UpdateSaleCampaignDto) {
    const existing = await this.prisma.saleCampaign.findUnique({
      where: { id },
      include: { items: { select: { productId: true } } },
    });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy chiến dịch sale có ID ${id}`);
    }

    const startsAt = dto.startsAt !== undefined
      ? (dto.startsAt ? new Date(dto.startsAt) : null)
      : existing.startsAt;
    const endsAt = dto.endsAt !== undefined
      ? (dto.endsAt ? new Date(dto.endsAt) : null)
      : existing.endsAt;
    this.assertWindow(startsAt, endsAt);

    const productIds = dto.productIds ?? existing.items.map((item) => item.productId);
    if (productIds.length !== new Set(productIds).size) {
      throw new BadRequestException('Danh sách sản phẩm không được trùng');
    }
    if (dto.productIds !== undefined) {
      await this.assertProductsExist(productIds);
    }

    const isActive = dto.isActive ?? existing.isActive;
    if (isActive) {
      await this.assertNoOverlap(productIds, { isActive, startsAt, endsAt }, id);
    }

    const campaign = await this.prisma.$transaction(async (tx) => {
      if (dto.productIds !== undefined) {
        await tx.saleCampaignItem.deleteMany({ where: { campaignId: id } });
        if (productIds.length > 0) {
          await tx.saleCampaignItem.createMany({
            data: productIds.map((productId) => ({ campaignId: id, productId })),
          });
        }
      }

      return tx.saleCampaign.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.discountPercent !== undefined
            ? { discountPercent: new Prisma.Decimal(dto.discountPercent) }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.startsAt !== undefined ? { startsAt } : {}),
          ...(dto.endsAt !== undefined ? { endsAt } : {}),
        },
        include: CAMPAIGN_INCLUDE,
      });
    });

    return this.toPublicCampaign(campaign);
  }

  async remove(id: string) {
    const existing = await this.prisma.saleCampaign.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy chiến dịch sale có ID ${id}`);
    }
    await this.prisma.saleCampaign.delete({ where: { id } });
    return { id };
  }

  private assertWindow(startsAt: Date | null, endsAt: Date | null) {
    if (startsAt && endsAt && startsAt >= endsAt) {
      throw new BadRequestException('Thời gian kết thúc phải sau thời gian bắt đầu');
    }
  }

  private async assertProductsExist(productIds: string[]) {
    if (productIds.length === 0) return;
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true },
    });
    const found = new Set(products.map((product) => product.id));
    const missing = productIds.filter((productId) => !found.has(productId));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'SALE_CAMPAIGN_PRODUCT_NOT_FOUND',
        message: 'Một số sản phẩm không tồn tại',
        productIds: missing,
      });
    }
  }

  private async assertNoOverlap(
    productIds: string[],
    next: CampaignWindow,
    excludeCampaignId?: string,
  ) {
    if (productIds.length === 0) return;

    const campaigns = await this.prisma.saleCampaign.findMany({
      where: {
        isActive: true,
        ...(excludeCampaignId ? { id: { not: excludeCampaignId } } : {}),
        items: { some: { productId: { in: productIds } } },
      },
      select: {
        id: true,
        name: true,
        startsAt: true,
        endsAt: true,
        items: { select: { productId: true }, where: { productId: { in: productIds } } },
      },
    });

    const conflicts = campaigns
      .filter((campaign) => windowsOverlap(next, campaign))
      .map((campaign) => ({
        campaignId: campaign.id,
        campaignName: campaign.name,
        productIds: campaign.items.map((item) => item.productId),
      }));

    if (conflicts.length > 0) {
      throw new ConflictException({
        code: 'SALE_CAMPAIGN_OVERLAP',
        message: 'Sản phẩm đã nằm trong một chiến dịch sale đang hoạt động cùng thời gian',
        conflicts,
      });
    }
  }

  private toPublicCampaign(campaign: CampaignWithCount) {
    return {
      id: campaign.id,
      name: campaign.name,
      discountPercent: Number(campaign.discountPercent),
      isActive: campaign.isActive,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      productCount: campaign._count.items,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
    };
  }

  private toPublicCampaignDetail(campaign: CampaignWithDetail) {
    return {
      ...this.toPublicCampaign(campaign),
      products: campaign.items.map((item) => item.product),
      productIds: campaign.items.map((item) => item.productId),
    };
  }
}

function windowsOverlap(
  a: CampaignWindow,
  b: { startsAt: Date | null; endsAt: Date | null },
) {
  const aStart = a.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const aEnd = a.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bStart = b.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const bEnd = b.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return aStart < bEnd && bStart < aEnd;
}
