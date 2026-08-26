import { GarmentCategory } from '@prisma/client';

/**
 * Số đo cơ thể bắt buộc để đặt may theo số đo (made-to-measure), theo từng phân
 * loại trang phục. Đây là bộ tối thiểu người thợ cần để cắt may; các số đo khác
 * (neck, wrist, calf...) là tuỳ chọn tinh chỉnh, không bắt buộc để đặt hàng.
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
 * Trả về các số đo còn thiếu (giá trị null/undefined) cho một tập phân loại trang
 * phục. Nhận measurement dạng bản ghi Prisma (các field có thể là Decimal|null).
 */
export function getMissingMeasurements(
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
