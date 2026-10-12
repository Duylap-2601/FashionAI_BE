interface GarmentImageLike {
  imageUrl: string;
  isMain: boolean;
  colorName: string | null;
}

// Trả về URL ảnh garment đúng màu đã chọn (match colorName, không phân biệt hoa
// thường/khoảng trắng); nếu không có ảnh khớp màu, rơi về ảnh mặc định của sản phẩm.
export function resolveGarmentUrlForColor(
  images: GarmentImageLike[],
  fallbackUrl: string,
  color?: string | null,
): string {
  if (color) {
    const normalized = color.trim().toLowerCase();
    const matches = images.filter(
      (img) => img.colorName && img.colorName.trim().toLowerCase() === normalized,
    );
    if (matches.length > 0) {
      return (matches.find((m) => m.isMain) ?? matches[0]).imageUrl;
    }
  }
  return fallbackUrl;
}
