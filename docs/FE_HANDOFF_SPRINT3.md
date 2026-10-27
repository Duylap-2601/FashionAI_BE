# FE Handoff — Sprint 3 (ảnh sản phẩm theo màu)

Tài liệu mô tả đúng những gì backend vừa đổi trong Sprint 3. Không có breaking change — field cũ giữ nguyên, chỉ thêm field/param mới (optional).

**Lưu ý quan trọng**: phần hạ tầng (API, DB) đã xong, nhưng để FE thấy ảnh đổi theo màu thật trên UI, sản phẩm phải được **admin upload lại ảnh có gắn màu** qua API mới ở mục 1. Sản phẩm cũ chưa upload lại thì mọi màu vẫn dùng chung 1 ảnh như trước (hành vi fallback, không lỗi).

## 1. Admin — upload ảnh sản phẩm có gắn màu

**Route không đổi path**: `POST /products` (tạo mới), `POST /products/:id/images` (thêm ảnh)

Cả 2 route giờ nhận thêm field `imageColors` (multipart form field, type `string`, chứa JSON array):

```
imageColors: '["Trắng", "Trắng", "Đen", null]'
```

- Đây là mảng **song song với mảng file ảnh** theo đúng thứ tự upload — ảnh thứ `i` thuộc màu `imageColors[i]`.
- Giá trị phải khớp (không phân biệt hoa/thường) với 1 tên trong `colors[].name` đã gửi ở field `colors`. Nếu không khớp → `400 Bad Request`, message: `Màu ảnh "X" không khớp với danh sách màu sản phẩm (colors)`.
- `null` (hoặc bỏ field `imageColors`) nghĩa là ảnh chung, không gắn màu cụ thể — dùng làm fallback khi màu đó chưa có ảnh riêng.
- Field `colors` (đã có từ trước) giờ được validate chặt hơn: mỗi phần tử phải đúng `{ name: string, hex: "#RRGGBB" }` — sai format sẽ bị `400` thay vì âm thầm chấp nhận.

Response `GET /products/:id` (và mọi response có object `images[]`) giờ mỗi ảnh có thêm field:

```ts
images: [
  { id: "...", imageUrl: "https://...", isMain: true, colorName: "Trắng" },
  { id: "...", imageUrl: "https://...", isMain: false, colorName: "Đen" },
  { id: "...", imageUrl: "https://...", isMain: false, colorName: null }, // ảnh chung
]
```

**Khuyến nghị cho FE (màn hình admin quản lý sản phẩm)**: khi upload ảnh, cho admin chọn màu tương ứng cho từng ảnh (dropdown lấy từ danh sách `colors` đã nhập) trước khi gọi API — đây là bước admin cần làm để tính năng đổi ảnh theo màu hoạt động trên các màn hình khách hàng.

## 2. Try-On (ghép đồ) — chọn màu khi gửi garment theo productId

**Route không đổi path**: `POST /try-on`

Mỗi garment trong `garments[]` giờ nhận thêm field `color` (optional, chỉ có ý nghĩa khi dùng `productId`, không áp dụng khi upload ảnh trực tiếp):

```
garments[0][productId]: "uuid-..."
garments[0][category]: "UPPER"
garments[0][color]: "Trắng"
```

Legacy single-garment (không dùng mảng `garments[]`) cũng nhận thêm field `color` tương tự ở top-level body.

Nếu không gửi `color`, hoặc màu gửi lên chưa có ảnh riêng, backend tự dùng ảnh mặc định của sản phẩm (hành vi y hệt trước đây).

Response trả thêm `color` trong từng garment để FE xác nhận đúng màu đã dùng:
```json
{
  "garments": [
    { "category": "UPPER", "productId": "...", "color": "Trắng" }
  ]
}
```

**Khuyến nghị cho FE**: khi khách đổi swatch màu trên trang sản phẩm/try-on, gửi kèm `color` (giá trị đúng như `colors[].name`) để ảnh ghép đúng màu khách chọn.

## 3. Live Try-On — chọn màu khi tạo/lấy garment

**3 route liên quan, không đổi path:**

**`GET /try-on/live/garments/:productId`** — thêm query param optional `color`:
```
GET /try-on/live/garments/abc-123?color=Đen
```
Response `imageUrl` trả đúng ảnh theo màu (nếu có), kèm field mới `color` xác nhận màu đã dùng.

**`POST /try-on/live/sessions`** (tạo session) — body thêm field optional `color`:
```json
{ "productId": "uuid-...", "color": "Đen" }
```
Màu này được **lưu lại trong session** suốt phiên — mọi response trạng thái session (`getSession`, `pauseSession`, `resumeSession`) đều trả `garment.imageUrl` đúng theo màu đã chọn lúc tạo session, và `garment.color` xác nhận giá trị.

**`POST /try-on/live/sessions/:id/resume`** — **không đổi**, không cần gửi lại `color`. Backend tự dùng lại màu đã lưu từ lúc tạo session.

**Khuyến nghị cho FE**: truyền `color` ngay khi mở Live Try-On session theo màu khách đang xem; không cần quan tâm lại màu khi gọi resume.

## 4. Đặt hàng — validate màu + snapshot đúng ảnh theo màu

**Route không đổi path**: `POST /orders`

- Field `items[].color` (đã có từ trước) giờ được **validate**: nếu sản phẩm có khai báo `colors` (không rỗng), `color` gửi lên phải khớp (case-insensitive) 1 trong `colors[].name`. Sai → `400 Bad Request`, message: `Màu "X" không hợp lệ cho sản phẩm "Tên sản phẩm"`.
- Sản phẩm **chưa khai báo `colors`** (mảng rỗng/null) thì giữ hành vi cũ — chấp nhận mọi string tùy ý, không validate.

**`GET /orders/:id`, `GET /orders`, `GET /orders/all`** — field `items[].productImageSnapshot` (đã tồn tại trong schema từ Sprint 2 nhưng trước đây luôn `null`) giờ được **ghi đúng giá trị** tại thời điểm đặt hàng: ảnh đúng theo màu khách đã chọn, hoặc ảnh mặc định nếu màu đó chưa có ảnh riêng.

```json
items: [
  {
    "color": "Đen",
    "productImageSnapshot": "https://.../ao-den.jpg"
  }
]
```

**Khuyến nghị cho FE**: 
- Hiển thị thẳng `message` từ lỗi 400 khi đặt hàng với màu không hợp lệ, thay vì câu thông báo chung.
- Màn hình lịch sử đơn hàng/chi tiết đơn nên dùng `items[].productImageSnapshot` để hiển thị đúng ảnh đã mua tại thời điểm đặt (tránh hiển thị sai nếu admin đổi ảnh sản phẩm sau này) — trước đây field này luôn `null` nên FE có thể đang fallback sang ảnh live của sản phẩm.

## Tóm tắt việc cần làm ở FE

| # | Việc | Bắt buộc? |
|---|---|---|
| 1 | Màn admin: cho chọn màu cho từng ảnh khi upload (field `imageColors`), hiển thị `images[].colorName` | Cần làm trước để tính năng có tác dụng |
| 2 | Try-On: gửi `garments[i][color]` theo màu khách chọn khi dùng `productId` | Khuyến nghị |
| 3 | Live Try-On: gửi `color` khi gọi `GET .../garments/:productId` và khi tạo session; không cần gửi lại khi resume | Khuyến nghị |
| 4 | Đặt hàng: hiển thị thẳng message lỗi 400 khi màu không hợp lệ; đổi màn hình đơn hàng dùng `items[].productImageSnapshot` thay vì ảnh live | Khuyến nghị |
