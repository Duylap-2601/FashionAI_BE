import { LayerRole } from '@prisma/client';
import {
  LIVE_PROMPT_MAX_LENGTH,
  buildLiveComboPrompt,
  pickPrimaryIndex,
} from '../../src/modules/try-on/utils/live-combo.util';

describe('pickPrimaryIndex', () => {
  it('chọn OUTER làm ảnh tham chiếu trong combo sơ mi + blazer + quần', () => {
    expect(pickPrimaryIndex([LayerRole.INNER, LayerRole.OUTER, LayerRole.BOTTOM])).toBe(1);
  });

  it('không có OUTER thì ưu tiên FULL_BODY rồi INNER', () => {
    expect(pickPrimaryIndex([LayerRole.BOTTOM, LayerRole.INNER])).toBe(1);
    expect(pickPrimaryIndex([LayerRole.FULL_BODY])).toBe(0);
  });

  it('một món thì luôn là món đó', () => {
    expect(pickPrimaryIndex([LayerRole.BOTTOM])).toBe(0);
  });
});

describe('buildLiveComboPrompt', () => {
  it('mô tả từ lớp ngoài xuống lớp dưới trong một action duy nhất', () => {
    const prompt = buildLiveComboPrompt([
      { layerRole: LayerRole.BOTTOM, name: 'trousers', color: 'beige' },
      { layerRole: LayerRole.OUTER, name: 'blazer', color: 'grey' },
      { layerRole: LayerRole.INNER, name: 'shirt', color: 'dark brown' },
    ]);

    expect(prompt.indexOf('grey blazer')).toBeLessThan(prompt.indexOf('dark brown shirt'));
    expect(prompt.indexOf('dark brown shirt')).toBeLessThan(prompt.indexOf('beige trousers'));
    expect(prompt).toContain('worn open as the outer layer');
    expect(prompt).toContain('underneath');
    expect(prompt.match(/Substitute the outfit/g)).toHaveLength(1);
  });

  it('không vượt giới hạn độ dài prompt', () => {
    const prompt = buildLiveComboPrompt([
      { layerRole: LayerRole.OUTER, name: 'x'.repeat(900), color: 'grey' },
      { layerRole: LayerRole.BOTTOM, name: 'y'.repeat(900) },
    ]);

    expect(prompt.length).toBeLessThanOrEqual(LIVE_PROMPT_MAX_LENGTH);
  });
});
