import {
  GARMENT_CANVAS_SIZE,
  buildCleanGarmentImageUrl,
  isCloudinaryImageUrl,
} from '../../src/modules/try-on/utils/garment-image.util';

const CLOUDINARY_URL =
  'https://res.cloudinary.com/demo/image/upload/v1700000000/fashionai/shirt.jpg';

describe('buildCleanGarmentImageUrl', () => {
  it('chèn trim + pad khung vuông nền trắng vào URL Cloudinary', () => {
    const result = buildCleanGarmentImageUrl(CLOUDINARY_URL);

    expect(result).toBe(
      'https://res.cloudinary.com/demo/image/upload/' +
        `e_trim/c_pad,w_${GARMENT_CANVAS_SIZE},h_${GARMENT_CANVAS_SIZE},b_white/` +
        'v1700000000/fashionai/shirt.jpg',
    );
  });

  it('idempotent: URL đã chuẩn hoá không bị chèn lần hai', () => {
    const once = buildCleanGarmentImageUrl(CLOUDINARY_URL);
    expect(buildCleanGarmentImageUrl(once)).toBe(once);
  });

  it('giữ nguyên URL không thuộc Cloudinary', () => {
    const external = 'https://cdn.example.com/garment.png';
    expect(buildCleanGarmentImageUrl(external)).toBe(external);
  });

  it('giữ nguyên chuỗi rỗng', () => {
    expect(buildCleanGarmentImageUrl('')).toBe('');
  });

  it('không nhận URL Cloudinary dạng video/raw', () => {
    expect(
      isCloudinaryImageUrl('https://res.cloudinary.com/demo/video/upload/v1/a.mp4'),
    ).toBe(false);
  });
});
