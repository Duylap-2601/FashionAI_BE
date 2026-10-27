import { LayerRole } from '@prisma/client';

/**
 * Decart realtime chỉ nhận MỘT ảnh tham chiếu mỗi phiên (`set()` thay toàn bộ
 * state, field `image` là số ít), nên combo nhiều món không thể gửi nhiều ảnh.
 *
 * Cách provider khuyến nghị: gửi ảnh của món "nhìn thấy nhiều nhất" làm nguồn
 * pixel, rồi mô tả cả bộ bằng prompt. Docs vton-3.5-prompting:
 *   "If the garment is open over another visible layer, describe the base layer too"
 *   ví dụ: "Substitute the upper body garment with a black blazer, worn open on
 *           top of a white crew-neck t-shirt."
 *
 * Đánh đổi phải biết trước: chỉ món primary được tái tạo đúng pixel; các món
 * còn lại chỉ là chữ trong prompt nên màu/chi tiết có thể lệch.
 */

/** Độ ưu tiên chọn ảnh tham chiếu: lớp ngoài che nhiều nhất thì đứng trước. */
const PRIMARY_PRIORITY: Record<LayerRole, number> = {
  [LayerRole.OUTER]: 0,
  [LayerRole.FULL_BODY]: 1,
  [LayerRole.INNER]: 2,
  [LayerRole.BOTTOM]: 3,
};

/** Thứ tự mô tả trong prompt: trên xuống dưới cho câu đọc tự nhiên. */
const DESCRIBE_ORDER: Record<LayerRole, number> = {
  [LayerRole.OUTER]: 0,
  [LayerRole.INNER]: 1,
  [LayerRole.FULL_BODY]: 2,
  [LayerRole.BOTTOM]: 3,
};

export const LIVE_PROMPT_MAX_LENGTH = 700;

export interface LiveComboItem {
  layerRole: LayerRole;
  name: string;
  color?: string | null;
  material?: string | null;
}

/**
 * Chọn món dùng làm ảnh tham chiếu. Ảnh này là source of truth nên ưu tiên lớp
 * ngoài: nếu có blazer thì blazer giữ đúng pixel, áo trong mô tả bằng lời.
 */
export function pickPrimaryIndex(layers: LayerRole[]): number {
  let bestIndex = 0;
  for (let i = 1; i < layers.length; i += 1) {
    if (PRIMARY_PRIORITY[layers[i]] < PRIMARY_PRIORITY[layers[bestIndex]]) {
      bestIndex = i;
    }
  }
  return bestIndex;
}

function describeItem(item: LiveComboItem): string {
  return [item.color, item.material, item.name]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const LAYER_PHRASE: Record<LayerRole, (desc: string) => string> = {
  [LayerRole.OUTER]: (d) => `${d} worn open as the outer layer`,
  [LayerRole.INNER]: (d) => `${d} underneath`,
  [LayerRole.FULL_BODY]: (d) => `${d} as a single full-body garment`,
  [LayerRole.BOTTOM]: (d) => `${d} on the lower body`,
};

/**
 * Prompt cho combo nhiều món. Một action duy nhất ("substitute the outfit")
 * theo khuyến nghị của docs là không trộn nhiều hành động trong một prompt.
 */
export function buildLiveComboPrompt(items: LiveComboItem[]): string {
  const described = [...items]
    .sort((a, b) => DESCRIBE_ORDER[a.layerRole] - DESCRIBE_ORDER[b.layerRole])
    .map((item) => {
      const desc = describeItem(item);
      return desc ? LAYER_PHRASE[item.layerRole](desc) : '';
    })
    .filter(Boolean);

  const instruction =
    'Substitute the outfit with the following, keeping each item its real color and details:';
  const tail =
    'Reproduce the reference image garment exactly; do not invent logos or details that are not visible.';
  const body = described.join(', ');

  const available = LIVE_PROMPT_MAX_LENGTH - instruction.length - tail.length - 3;
  const trimmedBody =
    body.length > available ? `${body.slice(0, Math.max(0, available - 3)).trimEnd()}...` : body;

  return [instruction, `${trimmedBody}.`, tail].filter(Boolean).join(' ');
}
