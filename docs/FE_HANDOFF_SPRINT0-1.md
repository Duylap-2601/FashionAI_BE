# FE Handoff — Sprint 0-1 (fix order detail, measurement cho thợ may, stylist warnings)

Tài liệu này mô tả đúng những gì backend vừa đổi, để FE cập nhật theo. Không có breaking change nào — mọi field cũ giữ nguyên, chỉ thêm field mới.

## 1. Giảm giá `-0` — không phải lỗi backend

Backend trả `discountAmount` là **số** (`0` khi không có coupon), không phải `null`. Đã kiểm tra lại `toPublicOrder`, logic null-check đã đúng từ trước.

**Nếu web đang hiện `-0`**, lỗi nằm ở phía FE: đang render `-${discountAmount}` mà không check `discountAmount > 0` trước. Cách sửa phía FE — ẩn hẳn dòng giảm giá khi `discountAmount` là `0` hoặc `null`:

```ts
{order.discountAmount > 0 && (
  <div>Giảm giá: -{formatVnd(order.discountAmount)}</div>
)}
```

Không có gì cần đổi ở cách gọi API.

## 2. Admin xem được chi tiết đơn của khách

**Route không đổi**: `GET /orders/:id`

Trước đây route này luôn lọc theo `userId` của người gọi, nên admin bấm vào đơn của khách sẽ nhận `404`. Giờ nếu người gọi có `role === ADMIN`, backend bỏ qua điều kiện đó và trả đơn theo đúng `id`/`orderCode`, không quan tâm đơn thuộc user nào.

- User thường gọi: vẫn chỉ xem được đơn của chính mình, 404 nếu không phải đơn của mình (hành vi cũ, không đổi).
- Admin gọi: xem được **mọi** đơn.

Không cần đổi gì ở cách FE gọi route này — chỉ cần đảm bảo trang admin order-detail đang gọi đúng `GET /orders/:id` (không phải đang tự chế logic nào khác để lấy chi tiết đơn).

## 3. Field mới trong order detail: `items[].measurementDisplay`

**Route**: `GET /orders/:id`, `GET /orders` (và `GET /orders/all` cho admin) — field này nằm trong mọi response trả về object đơn hàng, vì cùng đi qua `toPublicOrder`.

Mỗi item trong `order.items[]` giờ có thêm field `measurementDisplay`, bên cạnh `measurementSnapshot` cũ (giữ nguyên, không xóa):

```ts
items: [
  {
    id: "...",
    productId: "...",
    // ...các field cũ giữ nguyên...
    measurementSnapshot: {
      height: 170, weight: 60, chest: 88, waist: 70, hip: 92,
      shoulder: 40, neck: 39, sleeveLength: 62, wrist: 17,
      thigh: 54, knee: 38, calf: 37, inseam: 76, outseam: 99,
      shirtLength: 71, underbust: 82
    }, // 16 field thô, y hệt nhau cho mọi item trong đơn — field này KHÔNG đổi

    measurementDisplay: [ // field MỚI — đã lọc theo garmentType của item này
      { field: "height", label: "Chiều cao", value: 170, unit: "cm" },
      { field: "chest", label: "Vòng ngực", value: 88, unit: "cm" },
      { field: "shoulder", label: "Vai", value: 40, unit: "cm" },
      { field: "sleeveLength", label: "Dài tay áo", value: 62, unit: "cm" },
      { field: "shirtLength", label: "Dài thân áo", value: 71, unit: "cm" }
    ]
  }
]
```

**Vì sao có field mới**: `measurementSnapshot` lưu đủ 16 số đo cho mọi item bất kể là áo hay quần (do cách lưu lúc đặt hàng), nên nhìn vào nó không biết field nào thực sự dùng cho món này. `measurementDisplay` đã:
- Lọc chỉ còn field cần cho đúng loại trang phục của item (áo sơ mi khác quần tây).
- Gắn nhãn tiếng Việt (`label`) thay vì tên field thô.
- Gắn đơn vị (`unit`, hiện luôn là `"cm"`).

**Khuyến nghị cho FE**: màn hình chi tiết đơn (đặc biệt bên admin, cho thợ may xem) nên đổi sang render `measurementDisplay` thay vì tự lọc `measurementSnapshot`. Nếu `measurementDisplay` là mảng rỗng, nghĩa là chưa đủ dữ liệu số đo bắt buộc cho món đó.

Giữ `measurementSnapshot` lại nếu màn hình nào cần đối chiếu số đo gốc (ví dụ luồng xin khách bổ sung số đo), vì nó vẫn còn và không bị ảnh hưởng.

## 4. Route mới — Admin xem số đo của một user

```
GET /users/:id/measurements
Authorization: Bearer <admin token>
```

Chỉ ADMIN gọi được (`403` nếu không phải admin). Response giống hệt format của `GET /users/me/measurements` hiện có, chỉ khác là xem được số đo của **user bất kỳ** theo `:id`, không chỉ của chính mình:

```json
{
  "height": 170, "weight": 60, "chest": 88, "waist": 70, "hip": 92,
  "shoulder": 40, "neck": 39, "sleeveLength": 62, "wrist": 17,
  "thigh": 54, "knee": 38, "calf": 37, "inseam": 76, "outseam": 99,
  "shirtLength": 71, "underbust": 82,
  "bodyLength": 71,
  "trouserLength": 99
}
```

(`bodyLength` là alias của `shirtLength`, `trouserLength` là alias của `outseam` — giữ nguyên như route `/me/measurements` cũ, không có gì khác biệt ngoài scope theo `:id`.)

Nếu user đó chưa từng điền số đo, mọi field sẽ là `null` (route tự tạo record rỗng, không trả `404`).

**Dùng khi nào**: màn hình admin xử lý "yêu cầu khách bổ sung số đo" (measurement review) — trước đây admin không có cách nào xem khách đang điền gì, giờ gọi route này theo `userId` của khách (lấy từ `order.userId` trong chi tiết đơn).

## 5. Stylist — field mới `warnings`

**Route**: `POST /stylist/analyze` (không đổi input/cách gọi)

Response thêm field `warnings` (optional, luôn là mảng string, có thể rỗng):

```json
{
  "bodyType": "...",
  "skinTone": "...",
  "personalColor": "...",
  "fitRecommendation": "...",
  "fitAdvice": "...",
  "productCompatibilityScore": 85,
  "colorSuggestions": ["..."],
  "outfitCombinations": ["..."],
  "stylingTips": "...",
  "verdict": "...",
  "warnings": [
    "Dịp dạ tiệc và phong cách năng động/thể thao có thể không ăn khớp — đã ưu tiên gợi ý theo dịp mặc"
  ]
}
```

**Khi nào `warnings` có nội dung**:
- `occasion` (dịp mặc) và `stylePreference` (phong cách) mà người dùng nhập có vẻ mâu thuẫn nhau (ví dụ "dạ tiệc trang trọng" + "năng động thể thao"). AI tự chọn hướng ưu tiên hợp lý hơn và giải thích trong `warnings`, không block kết quả.
- `occasion` bị để trống, backend tự dùng giá trị mặc định "Công sở chuyên nghiệp" — `warnings` sẽ nói rõ đây là mặc định, gợi ý người dùng tự nhập dịp mặc cụ thể hơn.

**Khuyến nghị cho FE**: nếu `warnings` không rỗng, hiển thị như một banner/callout cảnh báo nhẹ phía trên kết quả tư vấn (không phải lỗi, chỉ là ghi chú để người dùng hiểu vì sao AI tư vấn theo hướng đó). Field này **optional** — nếu không xử lý UI ngay, bỏ qua cũng không vỡ gì, vì các field cũ không đổi.

Field này cũng xuất hiện giống nhau ở cả hai trường hợp: kết quả mới tính (`isCached: false`) và kết quả lấy từ cache (`isCached: true`).

## Tóm tắt việc cần làm ở FE

| # | Việc | Bắt buộc? |
|---|---|---|
| 1 | Sửa điều kiện render dòng giảm giá: chỉ hiện khi `discountAmount > 0` | Có, nếu đang bug `-0` |
| 2 | Không cần đổi gì — admin order detail tự nhiên xem được đơn khách khác qua route cũ | — |
| 3 | Đổi màn hình chi tiết đơn (ưu tiên bên admin) sang render `items[].measurementDisplay` thay vì tự lọc `measurementSnapshot` | Khuyến nghị |
| 4 | Dùng route mới `GET /users/:id/measurements` cho màn hình admin xử lý measurement review | Khi làm màn hình đó |
| 5 | Hiển thị `warnings` từ response stylist như banner cảnh báo, nếu mảng không rỗng | Khuyến nghị, không bắt buộc |
