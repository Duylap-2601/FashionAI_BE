import { GarmentCategory, GarmentType, Prisma } from '@prisma/client';
import {
  isNumericMeasurementValue,
  resolveItemRequiredFields,
} from '../../src/common/constants/measurement.constants';

describe('measurement constants', () => {
  it('accepts Prisma Decimal as a present measurement', () => {
    expect(isNumericMeasurementValue(new Prisma.Decimal('92.5'))).toBe(true);
    expect(isNumericMeasurementValue(new Prisma.Decimal('0'))).toBe(false);
  });

  it('accepts finite positive numbers and numeric strings only', () => {
    expect(isNumericMeasurementValue(92)).toBe(true);
    expect(isNumericMeasurementValue('92.5')).toBe(true);
    expect(isNumericMeasurementValue(0)).toBe(false);
    expect(isNumericMeasurementValue(-1)).toBe(false);
    expect(isNumericMeasurementValue('abc')).toBe(false);
    expect(isNumericMeasurementValue('')).toBe(false);
    expect(isNumericMeasurementValue(null)).toBe(false);
    expect(isNumericMeasurementValue(undefined)).toBe(false);
  });

  it('prefers garmentType over category', () => {
    expect(resolveItemRequiredFields({
      category: GarmentCategory.LOWER,
      garmentType: GarmentType.PANTS,
    })).toEqual(expect.arrayContaining(['waist', 'hip', 'thigh', 'inseam', 'outseam']));
  });

  it('falls back to category when garmentType is missing', () => {
    expect(resolveItemRequiredFields({ category: GarmentCategory.UPPER })).toEqual(
      expect.arrayContaining(['height', 'chest', 'shoulder', 'sleeveLength', 'shirtLength']),
    );
  });

  it('returns an empty list for unknown data instead of throwing', () => {
    expect(resolveItemRequiredFields({})).toEqual([]);
    expect(resolveItemRequiredFields({ category: 'UNKNOWN' as GarmentCategory })).toEqual([]);
  });
});
