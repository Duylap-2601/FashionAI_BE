import { LayerRole } from '@prisma/client';
import {
  layerCombinationError,
  MAX_TRY_ON_LAYERS,
} from '../../src/modules/try-on/utils/garment-combo.util';

describe('garment-combo.util', () => {
  it('cho phép OUTER + INNER (regression combo blazer + sơ mi)', () => {
    expect(layerCombinationError([LayerRole.OUTER, LayerRole.INNER])).toBeNull();
  });

  it('cho phép OUTER + INNER + BOTTOM', () => {
    expect(
      layerCombinationError([LayerRole.INNER, LayerRole.BOTTOM, LayerRole.OUTER]),
    ).toBeNull();
  });

  it('chặn 2 OUTER', () => {
    expect(layerCombinationError([LayerRole.OUTER, LayerRole.OUTER])).toContain(
      'khoác ngoài',
    );
  });

  it('chặn 2 INNER', () => {
    expect(layerCombinationError([LayerRole.INNER, LayerRole.INNER])).toContain(
      'mặc trong',
    );
  });

  it('chặn 2 BOTTOM', () => {
    expect(layerCombinationError([LayerRole.BOTTOM, LayerRole.BOTTOM])).toContain(
      'quần/chân váy',
    );
  });

  it('chặn FULL_BODY khi đi cùng món khác', () => {
    expect(
      layerCombinationError([LayerRole.FULL_BODY, LayerRole.OUTER]),
    ).toContain('FULL_BODY');
  });

  it('cho phép FULL_BODY đứng một mình', () => {
    expect(layerCombinationError([LayerRole.FULL_BODY])).toBeNull();
  });

  it('chặn vượt số món tối đa', () => {
    expect(
      layerCombinationError([
        LayerRole.INNER,
        LayerRole.BOTTOM,
        LayerRole.OUTER,
        LayerRole.INNER,
      ]),
    ).toContain(`Tối đa ${MAX_TRY_ON_LAYERS}`);
  });

  it('yêu cầu ít nhất 1 món', () => {
    expect(layerCombinationError([])).toContain('ít nhất 1');
  });
});
