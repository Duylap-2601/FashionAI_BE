import { GarmentCategory, GarmentType, LayerRole } from '@prisma/client';

export type FashnCategory = 'tops' | 'bottoms' | 'one-pieces';

/** Phần dữ liệu tối thiểu cần để xác định lớp mặc của một sản phẩm. */
export interface LayerRoleSource {
  layerRole?: LayerRole | null;
  garmentType?: GarmentType | null;
  category: GarmentCategory;
}

/**
 * Nguồn sự thật duy nhất cho phân lớp trang phục của Try-On/Stylist.
 * Ưu tiên `layerRole` do admin nhập; nếu trống thì suy luận từ `garmentType`,
 * cuối cùng fallback theo `category` (dữ liệu cũ chưa có garmentType).
 */
export function resolveLayerRole(product: LayerRoleSource): LayerRole {
  if (product.layerRole) return product.layerRole;

  switch (product.garmentType) {
    case GarmentType.JACKET:
    case GarmentType.VEST:
      return LayerRole.OUTER;
    case GarmentType.SHIRT:
      return LayerRole.INNER;
    case GarmentType.PANTS:
    case GarmentType.SKIRT:
      return LayerRole.BOTTOM;
    case GarmentType.DRESS:
    case GarmentType.JUMPSUIT:
      return LayerRole.FULL_BODY;
    default:
      break;
  }

  switch (product.category) {
    case GarmentCategory.LOWER:
      return LayerRole.BOTTOM;
    case GarmentCategory.FULL_BODY:
      return LayerRole.FULL_BODY;
    case GarmentCategory.UPPER:
    default:
      return LayerRole.INNER;
  }
}

export function layerRoleToGarmentCategory(role: LayerRole): GarmentCategory {
  switch (role) {
    case LayerRole.BOTTOM:
      return GarmentCategory.LOWER;
    case LayerRole.FULL_BODY:
      return GarmentCategory.FULL_BODY;
    case LayerRole.OUTER:
    case LayerRole.INNER:
    default:
      return GarmentCategory.UPPER;
  }
}

export function layerRoleToFashnCategory(role: LayerRole): FashnCategory {
  switch (role) {
    case LayerRole.BOTTOM:
      return 'bottoms';
    case LayerRole.FULL_BODY:
      return 'one-pieces';
    case LayerRole.OUTER:
    case LayerRole.INNER:
    default:
      return 'tops';
  }
}

/**
 * Thứ tự gửi ảnh cho FASHN: mặc trong trước, rồi quần/váy, cuối cùng là áo
 * khoác để lớp ngoài được đắp lên trên.
 */
export function layerRoleOrder(role: LayerRole): number {
  switch (role) {
    case LayerRole.INNER:
      return 0;
    case LayerRole.BOTTOM:
      return 1;
    case LayerRole.OUTER:
      return 2;
    case LayerRole.FULL_BODY:
      return 3;
    default:
      return 4;
  }
}
