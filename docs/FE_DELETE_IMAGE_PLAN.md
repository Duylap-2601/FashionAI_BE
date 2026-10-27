# Kế hoạch FE — Endpoint mới: Xóa 1 ảnh trong sản phẩm

**Ngày**: 2026-08-26
**Bối cảnh**: FE hiện đang xóa ảnh bằng cách gửi `PUT /api/products/:id` với mảng `images` đã bỏ ảnh cần xóa, kỳ vọng BE đồng bộ lại danh sách ảnh. Nhưng BE **không hỗ trợ** cách này — `images` là field do `FilesInterceptor`/`AnyFilesInterceptor` sinh ra (dùng cho upload file), không phải field dữ liệu, nên `PUT /products/:id` **luôn bỏ qua** field này. Kết quả: API trả `200 success` nhưng không xóa gì trong DB → reload lại ảnh vẫn còn.

**Giải pháp**: BE đã thêm endpoint riêng để xóa đúng 1 ảnh.

---

## 1. Endpoint mới

```
DELETE /api/products/:id/images/:imageId
Authorization: Bearer <admin_access_token>
```

| Param | Ý nghĩa |
|-------|---------|
| `id` | ID sản phẩm (UUID) |
| `imageId` | ID của ảnh trong bảng `product_images` (UUID) — lấy từ field `id` trong mảng `images[]` của response product, **không phải** URL ảnh |

### Response thành công (200)

```json
{
  "success": true,
  "code": "PRODUCT_IMAGE_DELETE_SUCCESS",
  "message": "Xóa ảnh sản phẩm thành công",
  "data": {
    "id": "product-uuid",
    "name": "Áo sơ mi trắng",
    "garmentUrl": "https://cdn.../new-main.jpg",
    "images": [
      { "id": "img-2", "imageUrl": "...", "isMain": true, "createdAt": "..." }
    ],
    ...
  }
}
```

`data` là **product đầy đủ** sau khi xóa (đã kèm `images[]` mới) — FE nên dùng thẳng response này để cập nhật UI, không cần gọi lại `GET /products/:id`.

### Lỗi có thể gặp

| Code | HTTP | Khi nào | UI nên làm gì |
|------|------|---------|---------------|
| (NotFound) | 404 | `imageId` không thuộc `id` sản phẩm này, hoặc sản phẩm không tồn tại | "Không tìm thấy ảnh, vui lòng tải lại trang" |
| (BadRequest) | 400 | Sản phẩm chỉ còn **1 ảnh duy nhất** — không cho xóa ảnh cuối | Disable nút xóa khi `images.length === 1`, hoặc bắt lỗi hiện: "Sản phẩm phải có ít nhất 1 ảnh. Hãy upload ảnh khác trước khi xóa ảnh này." |

---

## 2. Hành vi quan trọng cần biết: ảnh chính (`isMain`) tự chuyển

Nếu ảnh bị xóa đang là ảnh chính (`isMain: true`), BE sẽ **tự động** chọn ảnh còn lại mới nhất làm ảnh chính mới, và đồng bộ lại `garmentUrl` của product (field này dùng cho Try-On AI và Stylist — không tự derive từ `images[]`).

→ FE **không cần** tự tính lại ảnh chính hay gọi thêm API nào — chỉ cần dùng `images[]` trong response trả về để re-render, chú ý field `isMain` có thể đã đổi sang ảnh khác.

---

## 3. Việc cần sửa ở FE

- [ ] **Bỏ** flow xóa ảnh hiện tại (gửi `PUT /products/:id` với mảng `images` đã lược bớt) — cách này không hoạt động và sẽ tiếp tục gây ra hiện tượng "báo thành công nhưng không xóa".
- [ ] Thay bằng gọi `DELETE /api/products/:id/images/:imageId` cho từng ảnh muốn xóa.
- [ ] Sau khi xóa thành công, dùng `data` (product mới) trong response để cập nhật state — không cần refetch.
- [ ] Disable nút xóa (hoặc hiện tooltip) khi sản phẩm chỉ còn 1 ảnh.
- [ ] Bắt lỗi 404/400 riêng, hiện message tương ứng (xem bảng mục 2).
- [ ] Nếu UI có hiển thị "ảnh chính" bằng icon/badge riêng, đảm bảo UI đọc field `isMain` từ response mới nhất sau khi xóa — vì nó có thể đã chuyển sang ảnh khác.

## 4. Ví dụ gọi API

```typescript
async function deleteProductImage(productId: string, imageId: string) {
  const res = await fetch(`/api/products/${productId}/images/${imageId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.json();
    if (res.status === 400) {
      // Sản phẩm chỉ còn 1 ảnh
      toast.error(err.message);
    } else if (res.status === 404) {
      toast.error('Không tìm thấy ảnh, vui lòng tải lại trang');
    }
    throw new Error(err.message);
  }

  const { data } = await res.json();
  return data; // product mới, dùng để cập nhật UI ngay
}
```

---

**Lưu ý phụ**: Endpoint `POST /products` và `POST /products/:id/images` (upload ảnh) trước đó bị lỗi `400 Unexpected field` nếu FE gửi field `image` (số ít) thay vì `images` — lỗi này đã fix ở BE (chấp nhận cả 2 tên field), không cần FE đổi gì thêm, nhưng khuyến nghị dùng đúng tên `images` cho nhất quán với swagger doc.
