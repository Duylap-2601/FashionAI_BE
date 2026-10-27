# FE Handoff — Sprint 6 (Báo lỗi đơn hàng: hoàn tiền / đổi 1-1)

Tính năng mới hoàn toàn, chưa có ở các sprint trước. Khách báo lỗi sản phẩm trong đơn **đã hoàn tất (COMPLETED)**, admin xét duyệt rồi xử lý hoàn tiền hoặc đổi hàng.

## Nghiệp vụ cần biết trước khi dựng UI

- Chỉ tạo được yêu cầu khi đơn ở trạng thái `COMPLETED`, và trong vòng **7 ngày** kể từ lúc đơn chuyển `COMPLETED`. Quá hạn → `400`.
- Mỗi `orderItem` chỉ có **1 yêu cầu đang hoạt động** (`PENDING`/`APPROVED`) tại một thời điểm — tạo yêu cầu thứ 2 khi cái cũ chưa xử lý xong sẽ bị `400`.
- 4 lý do (`reason`): `WRONG_SIZE`, `WRONG_COLOR`, `QUALITY_MISMATCH`, `OTHER`. Theo chính sách, chỉ 3 lý do đầu được admin chấp nhận hoàn tiền/đổi hàng; `OTHER` vẫn tạo được nhưng khả năng cao bị admin từ chối (quyết định thủ công, không chặn ở code).
- Khách tự chọn **mong muốn xử lý** (`desiredResolution`: `REFUND` hoặc `EXCHANGE`) khi tạo yêu cầu — admin có thể duyệt đúng ý hoặc đổi hướng khác (có ghi chú giải thích).
- Hướng `EXCHANGE` chỉ được track trạng thái, **không tự động tạo đơn/vận đơn mới** — shop xử lý ship đổi hàng thủ công ngoài hệ thống, xong thì admin bấm "hoàn tất" trên hệ thống.
- Hướng `REFUND` khi admin duyệt sẽ tái dùng luồng hoàn tiền sẵn có — khách theo dõi tiến độ hoàn tiền qua các field refund đã có trên đơn hàng (`refundStatus`, `refunds[]`), không có field riêng nào khác.

## API

### 1. Tạo yêu cầu — `POST /orders/:orderId/items/:orderItemId/issues`

Multipart form-data, cần đăng nhập (user chủ đơn):

```
reason: "WRONG_SIZE" | "WRONG_COLOR" | "QUALITY_MISMATCH" | "OTHER"
description: string (10-2000 ký tự)
desiredResolution: "REFUND" | "EXCHANGE"
evidenceImages: file[] (field name chấp nhận: evidenceImages, images, hoặc image — tối đa 10MB/ảnh, định dạng jpeg/png/webp)
```

Response `data` (object `OrderIssue`):

```json
{
  "id": "uuid",
  "orderId": "uuid",
  "orderItemId": "uuid",
  "userId": "uuid",
  "reason": "WRONG_SIZE",
  "description": "Áo bị lệch vai trái khoảng 4cm so với số đo đã đặt",
  "desiredResolution": "REFUND",
  "approvedResolution": null,
  "evidenceImages": ["https://..."],
  "status": "PENDING",
  "adminNote": null,
  "adminId": null,
  "createdAt": "...",
  "updatedAt": "...",
  "order": { "id": "uuid", "orderCode": 1024, "status": "COMPLETED" },
  "orderItem": { "id": "uuid", "productId": "uuid", "quantity": 1, "color": "Đen", "productNameSnapshot": "...", "productImageSnapshot": "https://..." },
  "user": { "id": "uuid", "name": "...", "email": "..." }
}
```

Lỗi thường gặp (400): đơn chưa `COMPLETED`, quá 7 ngày, hoặc item đã có yêu cầu đang chờ xử lý — hiển thị thẳng `message` từ response.

### 2. Danh sách yêu cầu theo đơn — `GET /orders/:orderId/issues`

User chỉ xem được đơn của mình, admin xem mọi đơn. Query: `status?`, `reason?`, `page?`, `limit?`. Trả `data[]` (mảng `OrderIssue` như trên) + `meta.{total,page,limit,totalPages}`.

### 3. Chi tiết 1 yêu cầu — `GET /order-issues/:issueId`

Chủ đơn hoặc admin. Trả về object `OrderIssue` như trên.

### 4. Danh sách toàn hệ thống (Admin) — `GET /order-issues`

Chỉ `role=ADMIN`. Query: `status?`, `reason?`, `page?`, `limit?`.

### 5. Admin duyệt/từ chối — `PATCH /order-issues/:issueId/review`

Chỉ `role=ADMIN`, chỉ áp dụng khi yêu cầu đang `PENDING`.

```json
// Từ chối
{ "decision": "REJECT", "adminNote": "Lý do bắt buộc khi từ chối" }

// Duyệt
{ "decision": "APPROVE", "approvedResolution": "REFUND" | "EXCHANGE", "adminNote": "Ghi chú (optional)" }
```

- `APPROVE` + `REFUND` → `status` chuyển thẳng `RESOLVED`, đồng thời đơn hàng được chuyển sang luồng hoàn tiền có sẵn (`refundStatus = REQUIRED`). Nếu bước này lỗi, issue tự rollback về `PENDING` để admin thử lại — không bị kẹt ở trạng thái lệch.
- `APPROVE` + `EXCHANGE` → `status` chuyển `APPROVED` (chưa xong, chờ bước 6).
- `REJECT` → `status` chuyển `REJECTED`.

### 6. Admin đánh dấu đổi hàng hoàn tất — `PATCH /order-issues/:issueId/resolve`

Chỉ `role=ADMIN`, chỉ áp dụng khi `status = APPROVED` (tức đang chờ xử lý hướng `EXCHANGE`). Body: `{ "note": "optional" }`. Thành công → `status = RESOLVED`.

## Cập nhật liên quan: Lịch sử đơn hàng (`history[]`)

`GET /orders/:id` (và các route trả object đơn hàng khác) từ giờ có thêm các mốc mới trong `history[]` mỗi khi admin xử lý một yêu cầu báo lỗi, với `type` là một trong:

- `ORDER_ISSUE_REJECTED` — admin từ chối yêu cầu
- `ORDER_ISSUE_REFUND_APPROVED` — admin duyệt hoàn tiền
- `ORDER_ISSUE_EXCHANGE_APPROVED` — admin duyệt đổi hàng (chưa xong)
- `ORDER_ISSUE_EXCHANGE_RESOLVED` — đổi hàng đã hoàn tất

Mỗi event có `metadata: { issueId }` để FE link về đúng yêu cầu nếu cần, cấu trúc còn lại giống các event khác đã có sẵn (`publicMessage`, `occurredAt`, `source`, ...).

## Trạng thái (`status`) — vòng đời đầy đủ

```
PENDING → APPROVED → RESOLVED   (hướng EXCHANGE)
PENDING → RESOLVED              (hướng REFUND, duyệt là xong)
PENDING → REJECTED              (từ chối)
```

## Tóm tắt việc cần làm ở FE

| # | Việc | Bắt buộc? |
|---|---|---|
| 1 | Màn chi tiết đơn hàng (khách): nút "Báo lỗi sản phẩm" cho từng item khi đơn `COMPLETED` và còn trong hạn 7 ngày — form chọn `reason`, nhập `description`, chọn `desiredResolution`, upload ảnh minh chứng | Cần làm để tính năng có tác dụng |
| 2 | Màn theo dõi yêu cầu của khách: liệt kê `GET /orders/:orderId/issues`, hiển thị `status` + `adminNote` khi có | Cần làm |
| 3 | Màn admin: danh sách `GET /order-issues` (lọc theo `status`/`reason`), chi tiết, 2 action duyệt/từ chối và đánh dấu hoàn tất đổi hàng | Cần làm |
| 4 | Hiển thị các mốc `ORDER_ISSUE_*` mới trong timeline đơn hàng | Khuyến nghị |
| 5 | Hướng `REFUND` sau khi duyệt: điều hướng khách theo dõi tiến độ qua field `refundStatus`/`refunds[]` có sẵn trên đơn, không có API riêng nào khác cho phần này | Khuyến nghị |
