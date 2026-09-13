import { GarmentCategory, GarmentType } from '@prisma/client';

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

  return [...required].filter((field) => {
    const value = measurement?.[field];
    return value === null || value === undefined;
  });
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

  return [...required].filter((field) => {
    const value = measurement?.[field];
    return value === null || value === undefined;
  });
}
