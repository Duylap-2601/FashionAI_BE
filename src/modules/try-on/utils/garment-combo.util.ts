import { BadRequestException } from '@nestjs/common';
import { LayerRole } from '@prisma/client';

export const MAX_TRY_ON_LAYERS = 3;

const LAYER_ROLE_LABELS: Record<LayerRole, string> = {
  [LayerRole.OUTER]: 'khoác ngoài',
  [LayerRole.INNER]: 'mặc trong',
  [LayerRole.BOTTOM]: 'quần/chân váy',
  [LayerRole.FULL_BODY]: 'toàn thân',
};

/**
 * Luật ghép lớp: FULL_BODY đứng riêng; mỗi lớp chỉ 1 món; tối đa 3 món.
 * Trả message lỗi hoặc null để unit test không cần dựng HTTP layer.
 */
export function layerCombinationError(layers: LayerRole[]): string | null {
  if (layers.length === 0) {
    return 'Vui lòng chọn ít nhất 1 trang phục';
  }

  if (layers.length > MAX_TRY_ON_LAYERS) {
    return `Tối đa ${MAX_TRY_ON_LAYERS} trang phục mỗi lần. Bạn chọn ${layers.length}.`;
  }

  if (layers.length > 1 && layers.includes(LayerRole.FULL_BODY)) {
    return 'FULL_BODY (toàn thân) chỉ có thể đứng riêng, không kết hợp với trang phục khác';
  }

  const seen = new Set<LayerRole>();
  for (const layer of layers) {
    if (seen.has(layer)) {
      return `Không thể chọn nhiều hơn 1 trang phục ${LAYER_ROLE_LABELS[layer]}`;
    }
    seen.add(layer);
  }

  return null;
}

export function assertValidLayerCombination(layers: LayerRole[]): void {
  const message = layerCombinationError(layers);
  if (message) {
    throw new BadRequestException(message);
  }
}
