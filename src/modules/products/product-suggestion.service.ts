import { Injectable } from '@nestjs/common';
import { GarmentCategory, GarmentType, LayerRole, ProductGender, ProductStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { resolveLayerRole } from './utils/layer-role.util';

export type OutfitRole = 'outer' | 'top' | 'dress' | 'bottom';

/** Giới tính dùng để lọc catalog; UNISEX không phải đối tượng lọc mà luôn đi kèm cả hai. */
export type CatalogAudience = Exclude<ProductGender, typeof ProductGender.UNISEX>;

/** Một sản phẩm trong catalog rút gọn đưa vào prompt AI, tham chiếu bằng mã ngắn P1, P2... */
export interface StylingCatalogEntry {
  code: string;
  id: string;
  name: string;
  category: GarmentCategory;
  garmentType: GarmentType | null;
  layerRole: LayerRole;
  gender: ProductGender;
  colors: string[];
  material: string | null;
  price: number;
}

type CatalogProduct = Omit<StylingCatalogEntry, 'code'>;

export interface StylingCatalog {
  entries: StylingCatalogEntry[];
  byCode: Map<string, StylingCatalogEntry>;
  /** Lưu ý về giới tính cho AI, sinh từ `Product.gender` (VD cửa hàng chưa bán đồ nam). */
  audienceNote: string;
  /** Đổi khi sản phẩm được thêm/bớt khỏi catalog hoặc đổi giới tính, dùng làm một phần cache key. */
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
  layerRole: LayerRole;
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

const LAYER_ROLE_LABELS: Record<LayerRole, string> = {
  OUTER: 'Khoác ngoài',
  INNER: 'Mặc trong',
  BOTTOM: 'Quần/Chân váy',
  FULL_BODY: 'Toàn thân',
};

const GENDER_LABELS: Record<ProductGender, string> = {
  FEMALE: 'Nữ',
  MALE: 'Nam',
  UNISEX: 'Unisex',
};

const AUDIENCE_LABELS: Record<CatalogAudience, string> = {
  FEMALE: 'nữ',
  MALE: 'nam',
};

/**
 * Catalog cho AI Stylist/Chat: đưa danh sách sản phẩm đang bán vào prompt bằng mã ngắn,
 * rồi đổi mã AI trả về thành sản phẩm thật. Mã AI tự bịa (không có trong catalog) bị bỏ.
 */
@Injectable()
export class ProductSuggestionService {
  private cachedProducts: { value: CatalogProduct[]; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Catalog đang bán. Có `audience` thì chỉ giữ đồ của giới tính đó và đồ UNISEX,
   * mã P1..Pn đánh theo danh sách đã lọc.
   */
  async getCatalog(audience: CatalogAudience | null = null): Promise<StylingCatalog> {
    const products = await this.loadCatalogProducts();
    const matching = audience
      ? products.filter((product) => product.gender === audience || product.gender === ProductGender.UNISEX)
      : products;
    const entries = matching.map((product, index) => ({ code: `P${index + 1}`, ...product }));

    return {
      entries,
      byCode: new Map(entries.map((entry) => [entry.code, entry])),
      audienceNote: buildAudienceNote(products, audience),
      fingerprint: crypto
        .createHash('sha256')
        .update(entries.map((entry) => `${entry.id}:${entry.gender}`).sort().join('|'))
        .digest('hex')
        .slice(0, 16),
    };
  }

  private async loadCatalogProducts(): Promise<CatalogProduct[]> {
    if (this.cachedProducts && this.cachedProducts.expiresAt > Date.now()) {
      return this.cachedProducts.value;
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
        layerRole: true,
        gender: true,
        color: true,
        colors: true,
        material: true,
        price: true,
      },
    });

    const value = products.map((product) => {
      const colorNames = toColorNames(product.colors);
      return {
        id: product.id,
        name: product.name.trim(),
        category: product.category,
        garmentType: product.garmentType,
        layerRole: resolveLayerRole(product),
        gender: product.gender,
        colors: colorNames.length ? colorNames : product.color?.trim() ? [product.color.trim()] : [],
        material: product.material?.trim() || null,
        price: Number(product.price),
      };
    });
    this.cachedProducts = { value, expiresAt: Date.now() + CATALOG_CACHE_TTL_MS };
    return value;
  }

  formatCatalogForPrompt(catalog: StylingCatalog): string {
    return catalog.entries
      .map((entry) =>
        [
          entry.code,
          entry.name,
          entry.garmentType ? GARMENT_TYPE_LABELS[entry.garmentType] : CATEGORY_LABELS[entry.category],
          `lớp: ${LAYER_ROLE_LABELS[entry.layerRole]}`,
          `giới tính: ${GENDER_LABELS[entry.gender]}`,
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
            layerRole: resolveLayerRole(product),
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
            return product ? { role: toOutfitRole(product), note: item.note, product } : null;
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

/** Giới tính người dùng chọn ở AI Stylist ('male' | 'female' | 'other') sang giới tính lọc catalog; 'other'/trống thì không lọc. */
export function toCatalogAudience(genderPreference: string | null | undefined): CatalogAudience | null {
  switch (genderPreference?.trim().toLowerCase()) {
    case 'male':
      return ProductGender.MALE;
    case 'female':
      return ProductGender.FEMALE;
    default:
      return null;
  }
}

/** `products` là toàn bộ catalog (chưa lọc) để biết cửa hàng có bán đồ của từng giới tính hay không. */
function buildAudienceNote(products: CatalogProduct[], audience: CatalogAudience | null): string {
  const notes = [
    'Mục "giới tính" cho biết món dành cho ai, Unisex mặc được cho cả nam và nữ. Chỉ gợi ý món hợp với giới tính của người dùng.',
  ];
  if (audience) {
    notes.push(`Danh mục đã lọc theo giới tính người dùng: chỉ gồm đồ ${AUDIENCE_LABELS[audience]} và đồ unisex.`);
  }
  const genders: CatalogAudience[] = audience ? [audience] : [ProductGender.FEMALE, ProductGender.MALE];
  for (const gender of genders) {
    if (!products.some((product) => product.gender === gender)) {
      notes.push(`Cửa hàng hiện chưa bán đồ ${AUDIENCE_LABELS[gender]}.`);
    }
  }
  return notes.join(' ');
}

function toOutfitRole(product: Pick<SuggestedProduct, 'layerRole'>): OutfitRole {
  switch (product.layerRole) {
    case LayerRole.OUTER:
      return 'outer';
    case LayerRole.FULL_BODY:
      return 'dress';
    case LayerRole.BOTTOM:
      return 'bottom';
    case LayerRole.INNER:
    default:
      return 'top';
  }
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
