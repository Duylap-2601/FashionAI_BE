# Audit — FLW-002 (mobile)

Audit ngày 2026-11-18 trên `FashionAI_Mobile` commit `594f275` và bộ luật `checkout-to-delivery` (FLW-001).

## 1. Findings

| Severity | Check | Finding | Evidence | Required action |
|---|---|---|---|---|
| High | Forward | 21/42 TC chưa chạy; toàn bộ nhóm UI/WebView/poll/gate là `Not Run` | `05-execution.md`, `07-report.md` | Chạy trên staging/device trước khi coi flow là verified |
| High | Intent | BR-056 (PAID do backend) không được enforce; URL heuristic chuyển success | `PaymentScreen.tsx:handleWebViewNavigation:380-390`; BUG-022 | Sửa theo BUG-022 hoặc chấp nhận rủi ro có chữ ký |
| High | Intent | BR-011 của BE yêu cầu idempotency; mobile không gửi key | `orders.api.ts:createOrder:92-94`; BUG-023 | Sinh key ổn định cho mỗi lần đặt và retry |
| High | Intent | BR-047 fail-open khi completeness loading/lỗi | `CheckoutScreen.tsx:559`; BUG-024 | Chặn đặt khi chưa có completeness |
| High | Consistency | Payload quote/order chứa món `available=false` nhưng tổng giỏ loại món đó | `CheckoutScreen.tsx:356-361`; `use-cart.ts:359-367`; BUG-025 | Lọc một nguồn duy nhất trước quote/order |
| Medium | Backward | 11 defect đều là candidate, chưa có repro trên app thật | `06-defects.md` | Bổ sung repro/evidence khi chạy staging |
| Medium | Consistency | Hai bảng trạng thái khác nhãn/step giữa list và detail | `order-status.ts:7-32` vs `OrderDetailScreen.tsx:STATUS_CONFIG:89-154` | Hợp nhất một nguồn nhãn |
| Medium | Backward | `API-011` (tracking) không có caller; tracking phụ thuộc payload order 30s | `orders.api.ts:132`; BUG-031 | Gọi endpoint hoặc xác nhận payload luôn nhúng shipment |
| Medium | Consistency | Refund evidence chỉ hiện khi có ít nhất một refund COMPLETED | `OrderReturnParts.tsx:OrderRefundLines:67-70` | Xác nhận hợp đồng evidence BE rồi mở điều kiện |
| Medium | Consistency | `EOrderStatus` thiếu nhiều status runtime; type contract hẹp hơn dữ liệu | `types/order.ts:EOrderStatus` | Mở rộng enum hoặc đổi sang union string |
| Low | Consistency | `MAX_EVIDENCE_IMAGES` và `MAX_ISSUE_EVIDENCE_IMAGES` trùng nghĩa, dễ lệch | `order-returns.ts:128`; `evidence-images.ts:7` | Một nguồn hằng số |
| Low | Consistency | Dead client `paymentsApi.getPaymentOrders` | `payments.api.ts:33-35` | Xoá hoặc dùng |
| Low | Consistency | Picker ảnh từ chối quyền im lặng | BUG-032 | Thêm thông báo |
| Low | Consistency | Empty state Return-flow contradictory khi không có issue/refund | `OrderReturnsScreen.tsx:127-128`, `:212-264` | Sửa copy/điều kiện hiển thị |
| Low | Consistency | `jest.config.js` chỉ nhận `*.test.ts(x)`, bỏ 2 file `.test.mjs` | `jest.config.js:9`; `mobile-evidence-tests.md` | Đổi pattern hoặc chuyển đuôi |
| Low | Intent | `BR-052` gửi `BANK_TRANSFER` cố định; provider chọn riêng — đúng hiện tại nhưng dễ hiểu nhầm | `CheckoutScreen.tsx:607-616` | Ghi chú hợp đồng BE hoặc đổi tên field |

## 2. Kết luận audit

- **High:** 5 finding, tất cả gắn với BUG-022…BUG-025 hoặc khoảng trống execution; chưa đóng.
- **Không có broken reference** trong ma trận; không có ID trùng; 21 EXEC ánh xạ 1-1 với TC đã chạy.
- **Không có TC mồ côi**; 38/38 BR có TC; 24/24 AC có BR.
- **Chấp nhận mở (Accepted):** bộ tài liệu là read-only trên source, nên các finding High không được sửa tại đây. Chấp nhận chỉ có nghĩa “đã ghi nhận”; release mobile vẫn phải chặn theo `07-report.md`.

## 3. Open questions

### OQ-006 — URL cổng có được dùng làm tín hiệu thành công?
- **Question:** Với SePay, có chấp nhận heuristic URL hay bắt buộc `paymentId` + poll?
- **Why:** BUG-022 có thể là chủ ý tạm thời; nếu chủ ý, phải ghi thành rule thay vì BR-056.
- **Owner:** Mobile + Payments.

### OQ-007 — Vòng đời idempotency key của đơn
- **Question:** Key sinh một lần cho mỗi lần mở Checkout hay mỗi payload? Có tái dùng sau khi quote đổi không?
- **Why:** BUG-023; BE dedupe theo `(userId, key)` + fingerprint.
- **Owner:** Mobile + Orders.

### OQ-008 — Timeout OrderSuccess nên là “unknown” hay “failed”?
- **Question:** Sau 20s không thấy IPN, UI nên nói gì?
- **Why:** BUG-026; tránh khẳng định sai.
- **Owner:** Product + Payments.

### OQ-009 — Báo chưa nhận tiền hoàn cho đơn nhiều item
- **Question:** Gắn issue vào item nào khi refund ở cấp đơn?
- **Why:** BUG-027; BE BR-037 mô tả ở cấp order, mobile form lại cần `orderItemId`.
- **Owner:** Orders + Support.

### OQ-010 — Tracking lấy từ đâu?
- **Question:** `GET /orders/:id` có luôn nhúng `trackingUrl`/`currentShipment` không, hay phải gọi `API-011`?
- **Why:** BUG-031; ảnh hưởng độ mới của tracking.
- **Owner:** Orders + GHN integration.

### OQ-011 — Danh sách provider chủ đích
- **Question:** Mobile chỉ ZaloPay/SePay là quyết định sản phẩm hay thiếu MoMo/WALLET?
- **Why:** BE chấp nhận MoMo; mobile không có đường chọn.
- **Owner:** Product + Payments.

## 4. Remediation đã thực hiện trong bộ tài liệu

- Tách rule mobile khỏi rule BE; các rule trùng được tham chiếu chứ không định nghĩa lại.
- Ghi rõ 4 vi phạm intent thành BUG thay vì mô tả như hành vi chuẩn.
- Đánh dấu 21 TC `Not Run`; không dùng test count của Jest làm pass rate.
- Thêm AC/TC cho các khoảng trống phát hiện khi audit (TC-090…TC-092).
