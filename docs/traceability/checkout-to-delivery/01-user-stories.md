# User Stories & Acceptance Criteria — FLW-001

Quy ước `Status`: `Verified` = có `EXEC` chứng minh; `Unverified` = mới thiết kế hoặc chỉ có
bằng chứng code, chưa có lần chạy. `Evidence`: `Documented` · `Code-verified` · `Inferred` · `Unknown`.
Cập nhật 2026-11-18 sau lần chạy unit test duy nhất trong `05-execution.md`.

---

### US-001 — Giỏ hàng lai (guest + server)

- Actor: Customer (guest hoặc đã đăng nhập)
- Story: As a khách, I want giỏ hàng dùng được trước khi đăng nhập và đồng bộ sau khi đăng nhập, so that tôi không mất lựa chọn khi bị yêu cầu đăng nhập ở bước thanh toán.
- Description: Guest dùng Zustand + `localStorage['stale_cart']`; đăng nhập thì merge vào server cart.
- Preconditions: không có.
- Postconditions: giỏ server là nguồn dữ liệu duy nhất sau merge.
- Priority: High
- Source: `FashionAI_FE/src/features/cart/**`, `FashionAI_BE/src/modules/cart/**`
- Confidence: High
- Evidence: Code-verified
- Related AC: AC-001, AC-002, AC-003

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-001 | Khách chưa đăng nhập | Thêm món rồi tải lại trang | Giỏ còn nguyên trong `localStorage['stale_cart']`; chỉ `cartItems` được persist | Unverified |
| AC-002 | Khách đăng nhập với giỏ guest có món | `POST /cart/merge` chạy | Món trùng (productId+color+combo) giữ số lượng lớn hơn; giỏ guest được xoá | Unverified |
| AC-003 | Giỏ server có món ngừng bán | Mở `/cart` | Món hiển thị mờ, ghi “Đã ngừng bán, không tính vào đơn hàng.” và bị loại khỏi tổng/đơn | Unverified |

---

### US-002 — Báo giá và đặt đơn may đo

- Actor: Customer đã đăng nhập, hồ sơ đủ số đo
- Story: As a khách, I want thấy tổng tiền do hệ thống tính (giá, giảm giá, phí GHN) trước khi đặt, so that tôi biết chính xác phải trả bao nhiêu.
- Description: `/checkout` gọi `POST /orders/quote` mỗi khi đổi địa chỉ/món/ghi chú/mã; `POST /orders` gửi kèm `quoteToken`, `idempotencyKey`, `totalAmount`.
- Preconditions: có ≥1 địa chỉ hợp lệ; Admin đã cấu hình địa chỉ lấy hàng GHN.
- Postconditions: `Order` CREATED + `paymentStatus` PENDING + snapshot món/số đo/địa chỉ.
- Priority: Critical
- Source: `FashionAI_BE/src/modules/orders/orders.service.ts`, `FashionAI_FE/src/features/checkout/**`
- Confidence: High
- Evidence: Code-verified
- Related AC: AC-004 … AC-008, AC-036

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-004 | Client gửi `items[].price` sai | Tạo đơn | BE bỏ qua giá client, dùng giá DB/sale campaign | Unverified |
| AC-005 | Hồ sơ thiếu số đo bắt buộc của `garmentType` | Đặt hàng | 400 `MEASUREMENTS_INCOMPLETE` + danh sách `missing[]`; FE toast kèm link nhập số đo | Unverified |
| AC-006 | Quote quá 5 phút hoặc bị sửa | Đặt hàng | 400 `QUOTE_EXPIRED` / `QUOTE_CHANGED`; FE yêu cầu báo giá lại | Unverified |
| AC-007 | Sản phẩm DRAFT/ARCHIVED hoặc màu không thuộc `colors[]` | Đặt hàng | 400 “Sản phẩm không tồn tại hoặc chưa active” / “Màu … không hợp lệ” | Unverified |
| AC-008 | Cùng `idempotencyKey` + cùng payload | Gửi `POST /orders` hai lần | Lần hai trả lại đơn cũ, không tạo đơn mới | Unverified |
| AC-036 | Đơn `CREATED` + chưa thu tiền | Khách bấm Hủy | Đơn CANCELLED, payment PENDING → EXPIRED, coupon được trả lại | Unverified |

---

### US-003 — Thanh toán online và xác nhận tự động

- Actor: Customer, ZaloPay/SePay, System
- Story: As a khách, I want thanh toán qua ZaloPay hoặc chuyển khoản SePay và đơn tự xác nhận khi tiền vào, so that tôi không phải chờ shop xác nhận thủ công.
- Description: FE tạo link qua `POST /payments/checkout`; BE nhận callback/IPN/webhook, đối chiếu chữ ký + số tiền, ghi PAID trong transaction.
- Preconditions: đơn CREATED + PENDING của chính khách; `Payment` placeholder tồn tại.
- Postconditions: `Payment.status = PAID`, `Order.paymentStatus = PAID`, đơn sang `MEASUREMENT_REVIEW`.
- Priority: Critical
- Source: `FashionAI_BE/src/modules/payments/**`
- Confidence: High
- Evidence: Code-verified
- Related AC: AC-009 … AC-013, AC-034, AC-035

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-009 | Khách chọn “ZaloPay”/“Chuyển khoản ngân hàng” | Bấm Đặt hàng | Đơn tạo với `paymentMethod='BANK_TRANSFER'`; sau đó `POST /payments/checkout` với `provider` tương ứng | Unverified |
| AC-010 | Đơn không thuộc khách / đã PAID / không phải CREATED+PENDING | `POST /payments/checkout` | 404/400, không tạo link | Unverified |
| AC-011 | Callback/IPN/webhook hợp lệ | Hệ thống xử lý | Payment PAID + đơn MEASUREMENT_REVIEW; giỏ được dọn; notification + email | Unverified |
| AC-012 | Cổng báo đã thu nhưng sai số tiền/`requestId` hoặc đơn đã xử lý | Webhook xử lý | Payment → `REFUND_REQUIRED`; ghi `WebhookFailure`; không ghi PAID | Verified (EXEC-004) |
| AC-013 | Cổng báo thất bại/hết hạn | Webhook xử lý | Payment → FAILED (chỉ khi còn PENDING); đơn giữ CREATED để thanh toán lại | Verified (EXEC-004) |
| AC-034 | Đơn CREATED + PENDING quá 24 giờ | Cron hủy đơn chạy | Order CANCELLED, `paymentStatus EXPIRED`, coupon trả lại, khách nhận thông báo | Verified (EXEC-003) |
| AC-035 | Cùng một callback/IPN được gửi lại | Hệ thống xử lý | Lần hai trả DUPLICATE/ignored, không đổi trạng thái, không nhân đôi side effect | Unverified |

---

### US-004 — Theo dõi sản xuất và duyệt số đo

- Actor: Customer, Admin
- Story: As a khách, I want thấy đơn đang ở bước nào và được shop hỏi lại số đo nếu thiếu, so that tôi chủ động bổ sung trước khi may.
- Description: Trang `/orders/[id]` hiển thị trạng thái, timeline `OrderEvent`, vận đơn; Admin mở yêu cầu bổ sung số đo theo từng item.
- Preconditions: đơn đã PAID.
- Postconditions: `MEASUREMENT_REVIEW → MEASUREMENT_CONFIRMED` khi mọi review đóng.
- Priority: High
- Source: `orders.service.ts:updateStatus`, `FashionAI_FE/src/features/orders/components/orders-id-page.tsx`
- Confidence: High
- Evidence: Code-verified
- Related AC: AC-014 … AC-016

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-014 | Đơn có `history[]` + `currentShipment` | Mở chi tiết đơn | Hiển thị trạng thái, mốc thời gian, mã vận đơn, số tiền đã trả/đã hoàn | Unverified |
| AC-015 | Còn review số đo `OPEN`/`SUBMITTED` | Admin chuyển `MEASUREMENT_CONFIRMED` | 400, buộc đóng hết review trước | Unverified |
| AC-016 | Admin đổi trạng thái | Lưu thành công | `OrderEvent` mới + notification realtime + email với `PROCESSING`/`CANCELLED` | Unverified |

---

### US-005 — Xác nhận đã nhận hàng / báo chưa nhận

- Actor: Customer, GHN
- Story: As a khách, I want xác nhận đã nhận hàng hoặc báo chưa nhận trong 7 ngày, so that đơn được đóng đúng hạn và tranh chấp giao vận được xử lý.
- Description: GHN webhook đẩy trạng thái; khách bấm “Tôi đã nhận hàng” hoặc “Tôi chưa nhận được hàng”.
- Preconditions: hãng đã báo giao (`delivered`) hoặc đơn ở `SHIPPING`.
- Postconditions: `COMPLETED` hoặc `DELIVERY_DISPUTED`.
- Priority: High
- Source: `shipping.service.ts`, `orders.service.ts:confirmDelivery/createDeliveryDispute`
- Confidence: High
- Evidence: Code-verified
- Related AC: AC-017 … AC-019

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-017 | Đơn `DELIVERED` (hoặc `SHIPPING`/`READY_TO_SHIP` có vận đơn đã giao) | Khách xác nhận nhận hàng | Order COMPLETED + event/notification | Unverified |
| AC-018 | Hãng báo giao > 7 ngày | Khách báo chưa nhận | 400 “Đã quá 7 ngày…” | Unverified |
| AC-019 | GHN webhook hợp lệ, trạng thái mới hơn | Xử lý | Shipment cập nhật một lần; `READY_TO_SHIP→SHIPPING`, `→DELIVERED`; không lùi trạng thái | Verified (EXEC-010, EXEC-011) |

---

### US-006 — Báo lỗi / yêu cầu đổi trả

- Actor: Customer
- Story: As a khách, I want báo lỗi sản phẩm kèm ảnh và số tài khoản trong 7 ngày sau khi đơn hoàn tất, so that tôi được hoàn tiền mà không phải liên hệ ngoài hệ thống.
- Description: `POST /orders/:orderId/items/:orderItemId/issues` multipart; mỗi item tối đa một yêu cầu đang mở.
- Preconditions: đơn `COMPLETED` (hoặc đang trong luồng trả) và trong 7 ngày.
- Postconditions: `OrderIssue` PENDING; đơn `RETURN_REQUESTED`; admin nhận thông báo.
- Priority: High
- Source: `order-issues.service.ts:create`
- Confidence: High
- Evidence: Code-verified
- Related AC: AC-020 … AC-022

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-020 | Đơn `COMPLETED` quá 7 ngày | Tạo issue | 400 “Đã quá 7 ngày kể từ khi đơn hàng hoàn tất…” | Unverified |
| AC-021 | Thiếu ảnh hoặc STK sai định dạng | Tạo issue | 400 “Vui lòng đính kèm ít nhất 1 ảnh…” / “Số tài khoản phải gồm 6-20 chữ số” | Unverified |
| AC-022 | Item đã có issue PENDING/APPROVED/RESOLVED | Tạo issue mới | 400 “Sản phẩm này đã có yêu cầu xử lý…” | Unverified |

---

### US-007 — Hoàn tiền và xác nhận đã nhận tiền

- Actor: Admin, Customer
- Story: As a khách, I want được hoàn đúng số tiền của món lỗi (trừ phần giảm giá tương ứng) và xác nhận khi đã nhận, so that tranh chấp được đóng minh bạch.
- Description: Admin duyệt issue → tạo `Refund` GOODS (+SHIPPING nếu lỗi shop); chốt COMPLETED cần ảnh chứng từ.
- Preconditions: đơn đã thu tiền (`amountPaidVnd > 0`); đơn `RETURNED` nếu không “hoàn ngay”.
- Postconditions: `refundStatus` COMPLETED, `paymentStatus` PAID/PARTIALLY_REFUNDED/REFUNDED, khách xác nhận.
- Priority: Critical
- Source: `orders.service.ts:updateRefund`, `order-issues.service.ts:review`, `refund.util.ts`
- Confidence: High
- Evidence: Code-verified
- Related AC: AC-023 … AC-025

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-023 | Món giá 500k, đơn giảm 100k/1.000k | Duyệt hoàn món | Tiền hàng hoàn = 500k − 100k×50% = 450k; phí ship là khoản riêng | Verified (EXEC-012) |
| AC-024 | Đơn chưa `RETURNED` | Admin chốt hoàn COMPLETED | 400 “Cần xác nhận đã nhận lại hàng hoàn…” | Unverified |
| AC-025 | `refundStatus = COMPLETED` | Khách báo chưa nhận tiền | Mở lại khoản hoàn trong 7 ngày; refund cũ → FAILED | Unverified |

---

### US-008 — Admin vận hành đơn và vận đơn GHN

- Actor: Admin
- Story: As an admin, I want chuyển trạng thái đơn, tạo/hủy vận đơn và theo dõi GHN, so that đơn may đo đi đúng quy trình và khách thấy trạng thái thật.
- Description: `PATCH /orders/:id/status`, `POST /orders/:id/shipment`, `POST /admin/shipments/:id/cancel`, cron sync 5 phút.
- Preconditions: đơn đã PAID/READY_TO_SHIP; địa chỉ GHN 2 cấp hợp lệ.
- Postconditions: `Shipment` có `providerOrderCode`, trạng thái đồng bộ.
- Priority: High
- Source: `orders.service.ts:updateStatus/createShipment`, `shipping/**`
- Confidence: High
- Evidence: Code-verified
- Related AC: AC-026 … AC-028

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-026 | Đơn `TAILORING` | Admin đặt `SHIPPING` | 400 “Trạng thái này phải do thanh toán hoặc vận chuyển đã xác minh cập nhật.” | Unverified |
| AC-027 | Đơn chưa READY_TO_SHIP hoặc chưa PAID | Tạo vận đơn | 400 “Chỉ tạo vận đơn cho đơn may đo READY_TO_SHIP đã thanh toán.” | Unverified |
| AC-028 | Vận đơn đã PICKED | Admin hủy | 400 “Đơn vị vận chuyển đã lấy hàng, không thể hủy vận đơn.” | Verified (EXEC-008) |

---

### US-009 — Admin duyệt đổi trả và hoàn tiền

- Actor: Admin
- Story: As an admin, I want duyệt/từ chối yêu cầu đổi trả và chốt hoàn tiền kèm chứng từ, so that mọi khoản chi đều có vết và khách nhận được thông báo.
- Description: `PATCH /order-issues/:issueId/review`; “hoàn ngay” cần mã giao dịch + ảnh; issue RESOLVED khi mọi refund MANUAL đóng.
- Preconditions: issue PENDING.
- Postconditions: issue APPROVED/REJECTED/RESOLVED; `Refund` row theo từng kind.
- Priority: Critical
- Source: `order-issues.service.ts:review`, `orders.service.ts:updateRefund`
- Confidence: High
- Evidence: Code-verified
- Related AC: AC-029 … AC-031

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-029 | Admin từ chối không nhập lý do | Review REJECT | 400 “Từ chối yêu cầu cần kèm lý do (adminNote)” | Unverified |
| AC-030 | Chọn “hoàn ngay” thiếu ảnh/mã GD | Review APPROVE | 400 “Hoàn tiền ngay cần mã giao dịch và ảnh chứng từ chuyển khoản.” | Unverified |
| AC-031 | Đơn có 2 issue, một khoản hoàn chưa chốt | Chốt khoản đầu | Issue còn lại giữ APPROVED, đơn giữ `refundStatus=REQUIRED` | Unverified |

---

### US-010 — Admin đối soát thanh toán

- Actor: Admin
- Story: As an admin, I want thấy webhook lỗi và giao dịch chuyển khoản chưa khớp, so that tôi xác nhận tay hoặc hoàn tiền kịp thời.
- Description: `GET /payments/admin/webhook-failures`, `GET /payments/admin/unmatched-transactions`, `POST /payments/admin/orders/:orderCode/confirm-manual`.
- Preconditions: có webhook lỗi/giao dịch lạ.
- Postconditions: giao dịch được gán đơn hoặc đánh dấu đã xử lý; không tự động ghi PAID khi chưa xác nhận.
- Priority: High
- Source: `payments.service.ts:listWebhookFailures/listUnmatchedTransactions/confirmManualPayment`
- Confidence: High
- Evidence: Code-verified
- Related AC: AC-032, AC-033

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-032 | Webhook sai chữ ký/không khớp đơn | Hệ thống ghi nhận | `WebhookFailure` xuất hiện trong danh sách admin, đánh dấu resolved được | Unverified |
| AC-033 | Chuyển khoản không khớp mã đơn | Admin mở đối soát | Hiển thị giao dịch + tối đa 5 đơn PENDING cùng số tiền trong ±24h; không tự đổi trạng thái | Unverified |
