# FE Handoff — Sprint 2 (order detail đầy đủ tiền, filter danh sách đơn, coupon động)

Tài liệu mô tả đúng những gì backend vừa đổi trong Sprint 2. Không có breaking change — field cũ giữ nguyên, chỉ thêm field mới và thêm query param optional.

## 1. Order detail — thêm đầy đủ field tiền, refunds, payment detail

**Route**: `GET /orders/:id`, `GET /orders`, `GET /orders/all` — field mới nằm trong mọi response trả về object đơn hàng (cùng đi qua `toPublicOrder`).

### Field mới ở order-level

```ts
{
  // ...field cũ giữ nguyên (amount, itemsTotal, shippingFee, discountAmount, couponCode, status, ...)

  currency: "VND",
  itemsSubtotalVnd: 840000,      // tiền hàng (VND nguyên, không phải Decimal)
  shippingFeeVnd: 30000,
  discountVnd: 100000,
  taxVnd: 0,
  totalVnd: 770000,
  amountPaidVnd: 770000,         // đã thu được bao nhiêu
  amountRefundedVnd: 0,          // đã hoàn bao nhiêu
  shippingAddressSnapshot: { ... }, // snapshot địa chỉ tại thời điểm đặt
  shippingQuoteSnapshot: { ... },   // snapshot báo giá ship tại thời điểm đặt
  refundEvidence: null,          // bằng chứng hoàn tiền nếu có (ảnh/ghi chú), null nếu chưa hoàn
}
```

Field `shippingFee`/`discountAmount` (Decimal cũ) **vẫn còn**, không bị xóa. Field mới `*Vnd` là số nguyên VND, dùng cái này để hiển thị tiền cho chính xác (tránh sai số Decimal).

### Field mới: `order.refunds[]`

```ts
refunds: [
  {
    id: "...",
    paymentId: "...",
    provider: "SEPAY",
    amountVnd: 770000,
    reason: "Khách yêu cầu hủy đơn",
    status: "COMPLETED",       // PENDING | PROCESSING | COMPLETED | FAILED | CANCELLED
    requestedAt: "2026-10-01T...",
    processedAt: "2026-10-02T...",
    failedReason: null,
  }
]
```

Trước đây không có cách nào xem lịch sử refund của đơn qua route này — màn hình admin xử lý hoàn tiền nên hiển thị mảng này.

### Field mới ở `items[]`

```ts
items: [
  {
    // ...field cũ giữ nguyên (id, productId, quantity, color, measurementSnapshot, measurementDisplay, price, product, ...)
    productSkuSnapshot: "SKU-001",
    productImageSnapshot: "https://...",
    productCategorySnapshot: "UPPER",
    brandSnapshot: "FashionAI",
    unitPriceVnd: 350000,   // giá 1 sản phẩm tại thời điểm đặt (VND nguyên)
    lineTotalVnd: 700000,   // unitPriceVnd * quantity
  }
]
```

### Field mới ở `payments[]`

```ts
payments: [
  {
    id: "...",
    provider: "SEPAY",
    transactionId: "...",
    status: "PAID",        // PENDING | PAID | FAILED | REFUND_REQUIRED | ...
    amountVnd: 770000,      // MỚI — trước đây object payment không có số tiền
    createdAt: "...",
  }
]
```

**Khuyến nghị cho FE**: màn hình admin order-detail nên hiển thị thêm card "Chi tiết thanh toán" (dùng `payments[].amountVnd`/`status`) và card "Lịch sử hoàn tiền" (dùng `refunds[]`) — hai thông tin này trước đây hoàn toàn không lấy được qua API.

## 2. Danh sách đơn admin — filter mới

**Route**: `GET /orders/all` (admin only, không đổi path)

Trước đây chỉ nhận `page`/`limit`. Giờ nhận thêm 4 query param optional, có thể kết hợp tự do:

| Param | Kiểu | Ví dụ | Ghi chú |
|---|---|---|---|
| `status` | enum `OrderStatus` | `PENDING`, `PAID`, `COMPLETED`, ... | lọc đúng 1 trạng thái |
| `paymentStatus` | enum `PaymentStatus` | `PENDING`, `PAID`, `REFUNDED`, ... | lọc đúng 1 trạng thái thanh toán |
| `search` | string | `0012` hoặc `ORD-0012` hoặc tên/email khách | tìm theo mã đơn (số, có thể kèm/không kèm prefix `ORD-`), hoặc tên/email user (contains, không phân biệt hoa thường) |
| `fromDate` | ISO date | `2026-10-01` | lọc đơn tạo từ ngày này |
| `toDate` | ISO date | `2026-10-07` | lọc đơn tạo đến ngày này |

Ví dụ gọi:
```
GET /orders/all?status=PENDING&search=0012
GET /orders/all?paymentStatus=PAID&fromDate=2026-10-01&toDate=2026-10-07&page=1&limit=20
```

`page`/`limit` vẫn hoạt động như cũ. Nếu không truyền filter nào, hành vi y hệt trước (toàn bộ đơn, mới nhất trước).

Giá trị `status`/`paymentStatus` sai enum sẽ bị `400 Bad Request` (validate ở DTO), không âm thầm bỏ qua filter.

## 3. Coupon — chuyển từ hardcode sang model DB, có API quản lý

### 3.1. Hành vi `couponCode` khi tạo đơn — vẫn giữ cách gọi cũ

**Route**: `POST /orders` — field `couponCode` trong body không đổi tên, không đổi vị trí. FE **không cần sửa gì** ở luồng checkout nếu chỉ dùng 3 mã demo cũ (`WELCOME`, `STALE10`, `FASHIONAI` — đã được seed lại với hành vi giữ nguyên y hệt trước).

**Khác biệt duy nhất**: thông báo lỗi khi coupon không hợp lệ giờ cụ thể hơn, không còn chung 1 câu "Coupon code is invalid or expired" nữa. FE nên hiển thị thẳng `message` trả về từ lỗi 400 thay vì tự chế câu thông báo:

| Trường hợp | Message |
|---|---|
| Mã không tồn tại | `Mã giảm giá không tồn tại` |
| Mã bị tắt (`isActive=false`) | `Mã giảm giá đã bị tắt` |
| Chưa tới ngày bắt đầu | `Mã giảm giá chưa đến thời gian áp dụng` |
| Đã hết hạn | `Mã giảm giá đã hết hạn` |
| Đơn chưa đạt giá trị tối thiểu | `Đơn hàng chưa đạt giá trị tối thiểu để áp mã này` |
| Hết lượt dùng tổng | `Mã giảm giá đã hết lượt sử dụng` |
| User này đã dùng hết lượt cho phép | `Bạn đã sử dụng hết số lượt cho phép của mã giảm giá này` |

### 3.2. API mới — quản lý coupon (Admin only)

Base path: `/coupons`. Mọi route yêu cầu `Authorization: Bearer <admin token>`, trả `403` nếu không phải ADMIN.

**Tạo coupon** — `POST /coupons`
```json
{
  "code": "SALE20",
  "discountType": "PERCENTAGE",
  "discountValue": 20,
  "maxDiscountVnd": 200000,
  "minOrderVnd": 500000,
  "usageLimit": 100,
  "usageLimitPerUser": 1,
  "isActive": true,
  "startsAt": "2026-11-01T00:00:00.000Z",
  "expiresAt": "2026-11-30T23:59:59.000Z"
}
```
- `code`: tự động viết hoa, chỉ gồm chữ/số/`_`/`-`. Trùng mã → `409 Conflict`.
- `discountType`: `PERCENTAGE` hoặc `FIXED_AMOUNT`.
  - `PERCENTAGE`: `discountValue` là % (ví dụ `20` = giảm 20%), `maxDiscountVnd` là mức giảm tối đa (VND) — optional, bỏ trống = không giới hạn số tiền giảm.
  - `FIXED_AMOUNT`: `discountValue` chính là số tiền giảm cố định (VND), `maxDiscountVnd` **không có tác dụng** với loại này (không cần gửi).
- Mọi field khác optional, bỏ trống = không giới hạn (trừ `isActive` default `true`).

**Danh sách coupon** — `GET /coupons?page=1&limit=20`

**Chi tiết 1 coupon** — `GET /coupons/:id`

**Cập nhật coupon** — `PATCH /coupons/:id` — body giống `POST`, mọi field optional (chỉ gửi field muốn đổi).

**Xóa coupon** — `DELETE /coupons/:id`
- Nếu coupon đã từng được dùng trong đơn hàng (có `CouponRedemption`), xóa sẽ bị chặn với `400 Bad Request`, message: `"Không thể xóa mã giảm giá vì đã được sử dụng trong đơn hàng. Hãy tắt isActive thay vì xóa."` — FE nên gợi ý người dùng dùng `PATCH /coupons/:id` với `{ "isActive": false }` thay vì xóa trong trường hợp này.

Response object của coupon (ở cả list/detail/create/update):
```json
{
  "id": "uuid",
  "code": "SALE20",
  "discountType": "PERCENTAGE",
  "discountValue": "20",
  "maxDiscountVnd": "200000",
  "minOrderVnd": "500000",
  "usageLimit": 100,
  "usageLimitPerUser": 1,
  "usedCount": 3,
  "isActive": true,
  "startsAt": "2026-11-01T00:00:00.000Z",
  "expiresAt": "2026-11-30T23:59:59.000Z",
  "createdAt": "...",
  "updatedAt": "..."
}
```
Lưu ý: `discountValue`/`maxDiscountVnd`/`minOrderVnd` là field kiểu Decimal/BigInt ở DB nên trả về dạng string qua JSON (Prisma serialize) — FE cần `Number(...)` trước khi tính toán hoặc format hiển thị.

**Khuyến nghị cho FE**: nếu có màn hình admin quản lý khuyến mãi, đây là lúc build CRUD coupon — trước đây hoàn toàn không có API nào để tạo/sửa mã giảm giá, phải sửa code backend.

## Tóm tắt việc cần làm ở FE

| # | Việc | Bắt buộc? |
|---|---|---|
| 1 | Hiển thị thêm `payments[].amountVnd/status` và `refunds[]` ở màn admin order-detail | Khuyến nghị |
| 1 | Có thể đổi sang dùng field `*Vnd` (số nguyên) để hiển thị tiền thay vì field Decimal cũ | Khuyến nghị |
| 2 | Thêm UI filter (status/paymentStatus/search/fromDate/toDate) cho màn admin danh sách đơn, gọi `GET /orders/all` với query mới | Khi làm màn hình đó |
| 3 | Đổi cách hiển thị lỗi coupon ở checkout: hiện thẳng `message` từ lỗi 400 thay vì câu cứng | Khuyến nghị |
| 3 | Build màn hình admin CRUD coupon dùng `/coupons` API mới, nếu cần quản lý khuyến mãi qua UI | Khi làm màn hình đó |
