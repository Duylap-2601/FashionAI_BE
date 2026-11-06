import { GarmentCategory, GarmentType, Prisma } from '@prisma/client';

// Re-export GarmentType for use in DTOs and other modules (as both type and value)
export { GarmentType } from '@prisma/client';

/**
 * Số đo cơ thể bắt buộc để đặt may theo số đo (made-to-measure), theo từng loại
 * trang phục cụ thể (GarmentType). Đây là bộ tối thiểu người thợ cần để cắt may;
 * các số đo khác (neck, wrist, calf...) là tuỳ chọn tinh chỉnh, không bắt buộc để đặt hàng.
 */
export const REQUIRED_MEASUREMENTS_BY_TYPE: Record<
  GarmentType,
  readonly MeasurementField[]
> = {
  [GarmentType.SHIRT]: [
    'height',
    'chest',
    'shoulder',
    'sleeveLength',
    'shirtLength',
  ],
  [GarmentType.VEST]: [
    'height',
    'chest',
    'shoulder',
    'shirtLength',
  ],
  [GarmentType.JACKET]: [
    'height',
    'chest',
    'shoulder',
    'sleeveLength',
    'shirtLength',
  ],
  [GarmentType.PANTS]: [
    'height',
    'waist',
    'hip',
    'thigh',
    'inseam',
    'outseam',
  ],
  [GarmentType.SKIRT]: [
    'height',
    'waist',
    'hip',
    'outseam',
  ],
  [GarmentType.DRESS]: [
    'height',
    'chest',
    'waist',
    'hip',
    'shoulder',
    'shirtLength',
    'underbust',
  ],
  [GarmentType.JUMPSUIT]: [
    'height',
    'chest',
    'waist',
    'hip',
    'shoulder',
    'sleeveLength',
    'shirtLength',
    'inseam',
    'outseam',
  ],
};

/**
 * Fallback cho products chưa có garmentType: mapping từ category cũ.
 * @deprecated Chỉ dùng cho products legacy chưa được cập nhật garmentType
 */
export const REQUIRED_MEASUREMENTS_BY_CATEGORY: Record<
  GarmentCategory,
  readonly MeasurementField[]
> = {
  [GarmentCategory.UPPER]: [
    'height',
    'chest',
    'shoulder',
    'sleeveLength',
    'shirtLength',
  ],
  [GarmentCategory.LOWER]: ['height', 'waist', 'hip', 'outseam', 'thigh'],
  [GarmentCategory.FULL_BODY]: [
    'height',
    'chest',
    'waist',
    'hip',
    'shoulder',
    'shirtLength',
  ],
};

/** Các trường số đo trên model Measurement (tên field Prisma, không phải cột DB). */
export type MeasurementField =
  | 'height'
  | 'weight'
  | 'chest'
  | 'waist'
  | 'hip'
  | 'shoulder'
  | 'neck'
  | 'sleeveLength'
  | 'wrist'
  | 'thigh'
  | 'knee'
  | 'calf'
  | 'inseam'
  | 'outseam'
  | 'shirtLength'
  | 'underbust';

/** Khoảng hợp lệ duy nhất cho từng field; dùng chung cho DTO, order review và form. */
export const MEASUREMENT_RANGES: Record<MeasurementField, { min: number; max: number; unit: 'cm' | 'kg' }> = {
  height: { min: 100, max: 250, unit: 'cm' },
  weight: { min: 30, max: 300, unit: 'kg' },
  chest: { min: 50, max: 200, unit: 'cm' },
  waist: { min: 50, max: 200, unit: 'cm' },
  hip: { min: 50, max: 200, unit: 'cm' },
  shoulder: { min: 30, max: 80, unit: 'cm' },
  neck: { min: 28, max: 55, unit: 'cm' },
  sleeveLength: { min: 45, max: 80, unit: 'cm' },
  wrist: { min: 12, max: 25, unit: 'cm' },
  thigh: { min: 35, max: 90, unit: 'cm' },
  knee: { min: 25, max: 55, unit: 'cm' },
  calf: { min: 25, max: 55, unit: 'cm' },
  inseam: { min: 55, max: 95, unit: 'cm' },
  outseam: { min: 80, max: 120, unit: 'cm' },
  shirtLength: { min: 50, max: 85, unit: 'cm' },
  underbust: { min: 55, max: 130, unit: 'cm' },
};

/**
 * Giá trị số đo coi là "đã có" khi: number hữu hạn, Prisma Decimal, hoặc chuỗi số,
 * và lớn hơn 0. Phải nhận Prisma Decimal vì Measurement đọc từ DB trả Decimal.
 */
export function isNumericMeasurementValue(value: unknown): value is number | string | Prisma.Decimal {
  if (value === null || value === undefined || value === '') return false;
  if (Prisma.Decimal.isDecimal(value)) {
    return Number(value) > 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
  }
  return false;
}

/** Trả về field bắt buộc theo garmentType, fallback category; an toàn khi thiếu dữ liệu. */
export function resolveItemRequiredFields(item: {
  category?: GarmentCategory | string | null;
  garmentType?: GarmentType | string | null;
}): MeasurementField[] {
  const garmentType = item.garmentType;
  if (garmentType && garmentType in REQUIRED_MEASUREMENTS_BY_TYPE) {
    return [...REQUIRED_MEASUREMENTS_BY_TYPE[garmentType as GarmentType]];
  }
  const category = item.category as GarmentCategory | undefined | null;
  if (category && category in REQUIRED_MEASUREMENTS_BY_CATEGORY) {
    return [...REQUIRED_MEASUREMENTS_BY_CATEGORY[category]];
  }
  return [];
}

/** Nhãn tiếng Việt cho từng số đo, dùng trong thông báo lỗi và API completeness. */
export const MEASUREMENT_LABELS: Record<MeasurementField, string> = {
  height: 'Chiều cao',
  weight: 'Cân nặng',
  chest: 'Vòng ngực',
  waist: 'Vòng eo',
  hip: 'Vòng mông',
  shoulder: 'Vai',
  neck: 'Vòng cổ',
  sleeveLength: 'Dài tay',
  wrist: 'Cổ tay',
  thigh: 'Vòng đùi',
  knee: 'Vòng gối',
  calf: 'Bắp chân',
  inseam: 'Dài trong quần',
  outseam: 'Dài ngoài quần',
  shirtLength: 'Dài áo',
  underbust: 'Vòng chân ngực',
};

/**
 * Trả về các số đo còn thiếu cho đơn hàng dựa trên garmentType của từng sản phẩm.
 * Nếu sản phẩm không có garmentType (legacy), fallback về category.
 */
export function getMissingMeasurements(
  measurement: Partial<Record<MeasurementField, unknown>> | null,
  products: Array<{ category: GarmentCategory; garmentType?: string | null }>,
): MeasurementField[] {
  const required = new Set<MeasurementField>();

  for (const product of products) {
    let fieldsToAdd: readonly MeasurementField[];

    if (product.garmentType && product.garmentType in REQUIRED_MEASUREMENTS_BY_TYPE) {
      // Ưu tiên dùng garmentType nếu có
      fieldsToAdd = REQUIRED_MEASUREMENTS_BY_TYPE[product.garmentType as GarmentType];
    } else {
      // Fallback về category cho products legacy
      fieldsToAdd = REQUIRED_MEASUREMENTS_BY_CATEGORY[product.category];
    }

    for (const field of fieldsToAdd) {
      required.add(field);
    }
  }

  return [...required].filter((field) => !isNumericMeasurementValue(measurement?.[field]));
}

/**
 * @deprecated Legacy function - dùng cho code cũ, nên migrate sang version mới
 */
export function getMissingMeasurementsByCategory(
  measurement: Partial<Record<MeasurementField, unknown>> | null,
  categories: Iterable<GarmentCategory>,
): MeasurementField[] {
  const required = new Set<MeasurementField>();
  for (const category of categories) {
    for (const field of REQUIRED_MEASUREMENTS_BY_CATEGORY[category]) {
      required.add(field);
    }
  }

  return [...required].filter((field) => !isNumericMeasurementValue(measurement?.[field]));
}
