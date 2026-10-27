import { GarmentCategory, GarmentType, LayerRole } from '@prisma/client';
import {
  layerRoleOrder,
  layerRoleToFashnCategory,
  layerRoleToGarmentCategory,
  resolveLayerRole,
} from '../../src/modules/products/utils/layer-role.util';

describe('layer-role.util', () => {
  describe('resolveLayerRole', () => {
    it.each([
      [GarmentType.JACKET, LayerRole.OUTER],
      [GarmentType.VEST, LayerRole.OUTER],
      [GarmentType.SHIRT, LayerRole.INNER],
      [GarmentType.PANTS, LayerRole.BOTTOM],
      [GarmentType.SKIRT, LayerRole.BOTTOM],
      [GarmentType.DRESS, LayerRole.FULL_BODY],
      [GarmentType.JUMPSUIT, LayerRole.FULL_BODY],
    ])('suy luận %s thành %s khi chưa có layerRole', (garmentType, expected) => {
      expect(
        resolveLayerRole({
          layerRole: null,
          garmentType,
          category: GarmentCategory.UPPER,
        }),
      ).toBe(expected);
    });

    it('ưu tiên layerRole do admin nhập hơn suy luận từ garmentType', () => {
      expect(
        resolveLayerRole({
          layerRole: LayerRole.OUTER,
          garmentType: GarmentType.SHIRT,
          category: GarmentCategory.UPPER,
        }),
      ).toBe(LayerRole.OUTER);
    });

    it.each([
      [GarmentCategory.UPPER, LayerRole.INNER],
      [GarmentCategory.LOWER, LayerRole.BOTTOM],
      [GarmentCategory.FULL_BODY, LayerRole.FULL_BODY],
    ])('fallback theo category %s khi thiếu garmentType', (category, expected) => {
      expect(
        resolveLayerRole({ layerRole: null, garmentType: null, category }),
      ).toBe(expected);
    });
  });

  describe('map functions', () => {
    it('map LayerRole sang GarmentCategory', () => {
      expect(layerRoleToGarmentCategory(LayerRole.OUTER)).toBe(GarmentCategory.UPPER);
      expect(layerRoleToGarmentCategory(LayerRole.INNER)).toBe(GarmentCategory.UPPER);
      expect(layerRoleToGarmentCategory(LayerRole.BOTTOM)).toBe(GarmentCategory.LOWER);
      expect(layerRoleToGarmentCategory(LayerRole.FULL_BODY)).toBe(GarmentCategory.FULL_BODY);
    });

    it('map LayerRole sang FASHN category', () => {
      expect(layerRoleToFashnCategory(LayerRole.OUTER)).toBe('tops');
      expect(layerRoleToFashnCategory(LayerRole.INNER)).toBe('tops');
      expect(layerRoleToFashnCategory(LayerRole.BOTTOM)).toBe('bottoms');
      expect(layerRoleToFashnCategory(LayerRole.FULL_BODY)).toBe('one-pieces');
    });

    it('sắp thứ tự mặc: INNER → BOTTOM → OUTER → FULL_BODY', () => {
      const layers = [
        LayerRole.OUTER,
        LayerRole.FULL_BODY,
        LayerRole.INNER,
        LayerRole.BOTTOM,
      ];
      expect(layers.sort((a, b) => layerRoleOrder(a) - layerRoleOrder(b))).toEqual([
        LayerRole.INNER,
        LayerRole.BOTTOM,
        LayerRole.OUTER,
        LayerRole.FULL_BODY,
      ]);
    });
  });
});
