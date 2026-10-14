// Nếu sản phẩm có khai báo danh sách màu (colors), màu khách chọn phải khớp
// 1 trong số đó (không phân biệt hoa thường/khoảng trắng) — tránh lưu màu rác
// không map được ảnh. Sản phẩm chưa khai báo colors thì chấp nhận mọi màu.
//
// Trả về tên màu chuẩn của sản phẩm ("black" -> "Black") để mọi nơi lưu cùng một
// chuỗi; null khi màu không hợp lệ.
export function resolveProductColor(colors: unknown, color: string): string | null {
  const trimmed = color.trim();
  const list = Array.isArray(colors) ? (colors as Array<{ name?: unknown }>) : [];
  if (list.length === 0) return trimmed;
  const normalized = trimmed.toLowerCase();
  const matched = list.find(
    (c) => typeof c?.name === 'string' && c.name.trim().toLowerCase() === normalized,
  );
  return matched ? (matched.name as string).trim() : null;
}

export function isAllowedProductColor(colors: unknown, color: string): boolean {
  return resolveProductColor(colors, color) !== null;
}
