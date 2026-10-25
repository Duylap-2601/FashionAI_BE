/**
 * Chuẩn hoá ảnh garment trước khi gửi cho provider realtime.
 *
 * Decart khuyến nghị "clean garment image: just the item, on a plain
 * background, with no one wearing it" và tối thiểu 512x512, đồng thời coi ảnh
 * tham chiếu là source of truth cho món đồ. Ảnh catalog thường có người mẫu,
 * phông nền và props nên cần cắt viền + đệm về khung vuông nền trắng.
 *
 * Dùng Cloudinary URL transformation vì repo đã lưu ảnh sản phẩm ở Cloudinary:
 * không thêm dependency xử lý ảnh, không tốn thời gian xử lý lúc mở phiên.
 * Ảnh không nằm trên Cloudinary được trả về nguyên trạng.
 */

/** Khung vuông đủ lớn so với mức tối thiểu 512x512 Decart yêu cầu. */
export const GARMENT_CANVAS_SIZE = 1024;

/**
 * e_trim: cắt phần viền trùng màu góc ảnh.
 * c_pad + b_white: đệm về khung vuông, giữ nguyên tỷ lệ, nền trắng phẳng.
 * Không dùng e_background_removal vì đó là add-on phải bật riêng trên tài khoản.
 */
const GARMENT_TRANSFORMATION = `e_trim/c_pad,w_${GARMENT_CANVAS_SIZE},h_${GARMENT_CANVAS_SIZE},b_white`;

const CLOUDINARY_UPLOAD_MARKER = '/image/upload/';

export function isCloudinaryImageUrl(url: string): boolean {
  return url.includes('res.cloudinary.com') && url.includes(CLOUDINARY_UPLOAD_MARKER);
}

/**
 * Chèn transformation vào URL Cloudinary. Idempotent: URL đã chuẩn hoá rồi thì
 * trả về nguyên trạng để resume session không chèn transformation hai lần.
 */
export function buildCleanGarmentImageUrl(url: string): string {
  if (!url || !isCloudinaryImageUrl(url)) return url;
  if (url.includes('/e_trim/')) return url;

  const markerIndex = url.indexOf(CLOUDINARY_UPLOAD_MARKER);
  const prefix = url.slice(0, markerIndex + CLOUDINARY_UPLOAD_MARKER.length);
  const suffix = url.slice(markerIndex + CLOUDINARY_UPLOAD_MARKER.length);
  return `${prefix}${GARMENT_TRANSFORMATION}/${suffix}`;
}
