import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GarmentCategory, GarmentType, ProductStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';

export type OutfitRole = 'outer' | 'top' | 'dress' | 'bottom';

/** Một sản phẩm trong catalog rút gọn đưa vào prompt AI, tham chiếu bằng mã ngắn P1, P2... */
export interface StylingCatalogEntry {
  code: string;
  id: string;
  name: string;
  category: GarmentCategory;
  garmentType: GarmentType | null;
  colors: string[];
  material: string | null;
  price: number;
}

export interface StylingCatalog {
  entries: StylingCatalogEntry[];
  byCode: Map<string, StylingCatalogEntry>;
  /** Đối tượng khách của catalog (VD "thời trang nữ"): Product chưa có field giới tính nên AI không tự biết. */
  audienceNote: string;
  /** Đổi khi sản phẩm được thêm/bớt khỏi catalog, dùng làm một phần cache key. */
  fingerprint: string;
}

/** Outfit lưu DB: chỉ giữ productId để lúc đọc luôn lấy giá/ảnh/trạng thái mới nhất. */
export interface StoredOutfit {
  name: string;
  reason: string;
  items: { productId: string; note: string | null }[];
  extras: string[];
}

export interface SuggestedProduct {
  id: string;
  name: string;
  price: number;
  image: string | null;
  /** Màu mặc định khi thêm vào giỏ; null khi sản phẩm không khai báo danh sách màu. */
  color: string | null;
  garmentType: GarmentType | null;
  category: GarmentCategory;
  available: boolean;
}

export interface OutfitSuggestionItem {
  role: OutfitRole;
  note: string | null;
  product: SuggestedProduct;
}

export interface OutfitSuggestion {
  name: string;
  reason: string;
  items: OutfitSuggestionItem[];
  extras: string[];
  totalPrice: number;
}

export interface ResolveOutfitsOptions {
  /** Khi có, outfit nào không chứa sản phẩm này bị loại (người dùng đang hỏi về chính nó). */
  anchorProductId?: string | null;
}

// Catalog hiện ~30 món nên đưa nguyên vào prompt; vượt ngưỡng này cần lọc trước khi gửi AI.
const DEFAULT_AUDIENCE_NOTE = 'Toàn bộ sản phẩm hiện là thời trang NỮ (công sở, dự tiệc); cửa hàng chưa bán đồ nam.';
const CATALOG_LIMIT = 150;
const CATALOG_CACHE_TTL_MS = 60 * 1000;
const MAX_OUTFITS = 4;
const MAX_ITEMS_PER_OUTFIT = 5;
const MAX_EXTRAS = 4;
const MAX_SINGLE_PRODUCTS = 6;
const ROLE_ORDER: OutfitRole[] = ['outer', 'top', 'dress', 'bottom'];

const GARMENT_TYPE_LABELS: Record<GarmentType, string> = {
  SHIRT: 'Áo sơ mi/áo kiểu',
  VEST: 'Áo vest',
  JACKET: 'Áo khoác/blazer',
  PANTS: 'Quần',
  SKIRT: 'Chân váy',
  DRESS: 'Đầm',
  JUMPSUIT: 'Jumpsuit',
};

const CATEGORY_LABELS: Record<GarmentCategory, string> = {
  UPPER: 'Áo',
  LOWER: 'Quần/Váy',
  FULL_BODY: 'Toàn thân',
};

/**
 * Catalog cho AI Stylist/Chat: đưa danh sách sản phẩm đang bán vào prompt bằng mã ngắn,
 * rồi đổi mã AI trả về thành sản phẩm thật. Mã AI tự bịa (không có trong catalog) bị bỏ.
 */
@Injectable()
export class ProductSuggestionService {
  private cachedCatalog: { value: StylingCatalog; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getCatalog(): Promise<StylingCatalog> {
    if (this.cachedCatalog && this.cachedCatalog.expiresAt > Date.now()) {
      return this.cachedCatalog.value;
    }

    const products = await this.prisma.product.findMany({
      where: { status: ProductStatus.ACTIVE },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: CATALOG_LIMIT,
      select: {
        id: true,
        name: true,
        category: true,
        garmentType: true,
        color: true,
        colors: true,
        material: true,
        price: true,
      },
    });

    const entries = products.map((product, index) => {
      const colorNames = toColorNames(product.colors);
      return {
        code: `P${index + 1}`,
        id: product.id,
        name: product.name.trim(),
        category: product.category,
        garmentType: product.garmentType,
        colors: colorNames.length ? colorNames : product.color?.trim() ? [product.color.trim()] : [],
        material: product.material?.trim() || null,
        price: Number(product.price),
      };
    });

    const value: StylingCatalog = {
      entries,
      byCode: new Map(entries.map((entry) => [entry.code, entry])),
      audienceNote: this.config.get<string>('AI_CATALOG_AUDIENCE_NOTE')?.trim() || DEFAULT_AUDIENCE_NOTE,
      fingerprint: crypto
        .createHash('sha256')
        .update(entries.map((entry) => entry.id).sort().join('|'))
        .digest('hex')
        .slice(0, 16),
    };
    this.cachedCatalog = { value, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS };
    return value;
  }

  formatCatalogForPrompt(catalog: StylingCatalog): string {
    return catalog.entries
      .map((entry) =>
        [
          entry.code,
          entry.name,
          entry.garmentType ? GARMENT_TYPE_LABELS[entry.garmentType] : CATEGORY_LABELS[entry.category],
          entry.colors.length ? `màu: ${entry.colors.join(', ')}` : null,
          entry.material ? `chất liệu: ${entry.material}` : null,
          `${entry.price.toLocaleString('vi-VN')}đ`,
        ]
          .filter((part): part is string => Boolean(part))
          .join(' | '),
      )
      .join('\n');
  }

  findCodeByProductId(catalog: StylingCatalog, productId: string): string | null {
    return catalog.entries.find((entry) => entry.id === productId)?.code ?? null;
  }

  /** Đổi outfit AI trả về (tham chiếu bằng mã) thành outfit lưu DB, bỏ mã không hợp lệ. */
  resolveOutfits(
    raw: unknown,
    catalog: StylingCatalog,
    options: ResolveOutfitsOptions = {},
  ): StoredOutfit[] {
    if (!Array.isArray(raw)) return [];

    const outfits: StoredOutfit[] = [];
    for (const candidate of raw) {
      if (!isRecord(candidate) || !Array.isArray(candidate.items)) continue;

      const seen = new Set<string>();
      const items: StoredOutfit['items'] = [];
      for (const rawItem of candidate.items) {
        const entry = this.lookupCode(catalog, isRecord(rawItem) ? (rawItem.code ?? rawItem.productCode) : rawItem);
        if (!entry || seen.has(entry.id)) continue;
        seen.add(entry.id);
        items.push({ productId: entry.id, note: isRecord(rawItem) ? toText(rawItem.note) : null });
        if (items.length === MAX_ITEMS_PER_OUTFIT) break;
      }

      const isSingleDress =
        items.length === 1 && catalog.entries.find((e) => e.id === items[0].productId)?.category === GarmentCategory.FULL_BODY;
      if (items.length < 2 && !isSingleDress) continue;
      if (options.anchorProductId && !seen.has(options.anchorProductId)) continue;

      outfits.push({
        name: toText(candidate.name) ?? `Bộ phối ${outfits.length + 1}`,
        reason: toText(candidate.reason) ?? '',
        items,
        extras: toTextList(candidate.extras).slice(0, MAX_EXTRAS),
      });
      if (outfits.length === MAX_OUTFITS) break;
    }
    return outfits;
  }

  /** Đổi danh sách mã sản phẩm lẻ AI gợi ý thành productId hợp lệ, bỏ trùng. */
  resolveProductCodes(raw: unknown, catalog: StylingCatalog): string[] {
    if (!Array.isArray(raw)) return [];
    const ids = raw
      .map((code) => this.lookupCode(catalog, isRecord(code) ? code.code : code)?.id)
      .filter((id): id is string => Boolean(id));
    return [...new Set(ids)].slice(0, MAX_SINGLE_PRODUCTS);
  }

  /** Mô tả một outfit thành chuỗi ngắn: dùng cho `outfitCombinations` cũ và lịch sử chat gửi lại AI. */
  describeOutfit(outfit: StoredOutfit, catalog: StylingCatalog): string {
    const names = outfit.items
      .map((item) => catalog.entries.find((entry) => entry.id === item.productId)?.name)
      .filter((name): name is string => Boolean(name));
    return `${outfit.name}: ${names.join(' + ')}`;
  }

  /** Đọc lại outfit đã lưu trong JSON (DB) một cách an toàn. */
  parseStoredOutfits(raw: unknown): StoredOutfit[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(isRecord).map((outfit) => ({
      name: toText(outfit.name) ?? '',
      reason: toText(outfit.reason) ?? '',
      items: Array.isArray(outfit.items)
        ? outfit.items
            .filter(isRecord)
            .filter((item) => typeof item.productId === 'string')
            .map((item) => ({ productId: item.productId as string, note: toText(item.note) }))
        : [],
      extras: toTextList(outfit.extras),
    }));
  }

  async loadProducts(productIds: string[]): Promise<Map<string, SuggestedProduct>> {
    const ids = [...new Set(productIds)];
    if (!ids.length) return new Map();

    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: { images: true },
    });

    return new Map(
      products.map((product) => {
        const image =
          product.images.find((img) => img.isMain)?.imageUrl ??
          product.images[0]?.imageUrl ??
          product.garmentUrl ??
          null;
        return [
          product.id,
          {
            id: product.id,
            name: product.name.trim(),
            price: Number(product.price),
            image,
            color: toColorNames(product.colors)[0] ?? null,
            garmentType: product.garmentType,
            category: product.category,
            available: product.status === ProductStatus.ACTIVE,
          },
        ];
      }),
    );
  }

  /** Ghép outfit đã lưu với sản phẩm đã load; món bị xóa hẳn khỏi DB thì bỏ khỏi outfit. */
  buildOutfits(stored: StoredOutfit[], products: Map<string, SuggestedProduct>): OutfitSuggestion[] {
    return stored
      .map((outfit) => {
        const items = outfit.items
          .map((item) => {
            const product = products.get(item.productId);
            return product ? { role: toRole(product), note: item.note, product } : null;
          })
          .filter((item): item is OutfitSuggestionItem => item !== null)
          .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));

        return {
          name: outfit.name,
          reason: outfit.reason,
          items,
          extras: outfit.extras,
          totalPrice: items
            .filter((item) => item.product.available)
            .reduce((sum, item) => sum + item.product.price, 0),
        };
      })
      .filter((outfit) => outfit.items.length > 0);
  }

  async hydrateOutfits(raw: unknown): Promise<OutfitSuggestion[]> {
    const stored = this.parseStoredOutfits(raw);
    const products = await this.loadProducts(collectProductIds(stored));
    return this.buildOutfits(stored, products);
  }

  private lookupCode(catalog: StylingCatalog, raw: unknown): StylingCatalogEntry | undefined {
    if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
    const normalized = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return catalog.byCode.get(/^\d+$/.test(normalized) ? `P${normalized}` : normalized);
  }
}

export function collectProductIds(outfits: StoredOutfit[]): string[] {
  return outfits.flatMap((outfit) => outfit.items.map((item) => item.productId));
}

function toRole(product: Pick<SuggestedProduct, 'category' | 'garmentType'>): OutfitRole {
  if (product.garmentType === GarmentType.JACKET) return 'outer';
  if (
    product.garmentType === GarmentType.DRESS ||
    product.garmentType === GarmentType.JUMPSUIT ||
    product.category === GarmentCategory.FULL_BODY
  ) {
    return 'dress';
  }
  if (
    product.garmentType === GarmentType.PANTS ||
    product.garmentType === GarmentType.SKIRT ||
    product.category === GarmentCategory.LOWER
  ) {
    return 'bottom';
  }
  return 'top';
}

function toColorNames(colors: unknown): string[] {
  if (!Array.isArray(colors)) return [];
  return colors
    .map((color) => (isRecord(color) && typeof color.name === 'string' ? color.name.trim() : ''))
    .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(toText).filter((text): text is string => text !== null);
}
