# Defects — FLW-002 (mobile)

Tất cả mục dưới đây là **defect candidate** dựa trên đọc code + test hiện có; chưa có lần chạy app thật để tái hiện trên thiết bị. Trạng thái `Open` không đồng nghĩa đã xác nhận bằng môi trường staging.

## BUG-022 — Mobile coi URL có chữ “success” là đã thanh toán

- **Severity:** High · **Priority:** P0 · **Status:** Open (defect candidate)
- **Related:** US-012 / AC-040 / BR-056 / SCR-019 / TC-063, TC-089
- **Environment:** Mobile `594f275`, PaymentScreen SePay/đơn hàng; backend trả `checkoutUrl` có `success_url`/`cancel_url`.
- **Reproduction:**
  1. Tạo đơn, chọn SePay, mở WebView.
  2. Cổng load URL có query `success_url=...` (hoặc bất kỳ URL chứa “success”) trước khi thanh toán.
  3. `onNavigationStateChange` chạy heuristic.
- **Expected:** chỉ chuyển OrderSuccess khi `GET /payments/:id` trả PAID.
- **Actual:** `handleWebViewNavigation` thấy “success” → gọi `handlePaymentSuccess()` ngay; đơn SePay thường còn PENDING và không có `paymentId` để poll.
- **Evidence:** `PaymentScreen.tsx:handleWebViewNavigation:380-390`; `shouldPollPaymentStatus:209`; BE tạo URL `success_url` trong `payments.service.ts:createSePayCheckoutLink:322-335`.
- **Root cause:** Heuristic chuỗi thay cho xác nhận server; SePay checkout response thiếu `paymentId` nên không có nguồn xác nhận thay thế.
- **Resolution:** Chưa sửa. Cần backend trả `paymentId` cho SePay hoặc dùng trạng thái đơn làm nguồn duy nhất trước khi điều hướng.

## BUG-023 — Tạo đơn không có idempotency key

- **Severity:** High · **Priority:** P0 · **Status:** Open (defect candidate)
- **Related:** US-011 / AC-039 / BR-053 / SCR-018 / TC-058
- **Reproduction:**
  1. Bấm Đặt hàng; backend tạo đơn nhưng response bị mất/timeout.
  2. Nút bật lại; bấm lần hai.
- **Expected:** cùng key trả đơn cũ (BE hỗ trợ `idempotencyKey`).
- **Actual:** mobile không sinh/gửi key → đơn thứ hai được tạo.
- **Evidence:** `CheckoutScreen.tsx:handlePlaceOrder:597-610`; `orders.api.ts:createOrder:92-94`; field khai báo nhưng bỏ trống `:41`.
- **Root cause:** Client không dùng hợp đồng idempotency của BE.
- **Resolution:** Chưa sửa.

## BUG-024 — Cổng số đo bị bỏ qua khi completeness đang tải/lỗi

- **Severity:** High · **Priority:** P1 · **Status:** Open (defect candidate)
- **Related:** US-011 / AC-038 / BR-047 / SCR-018 / TC-055
- **Reproduction:** mở Checkout khi `/users/me/measurements/completeness` chậm hoặc lỗi; bấm Đặt hàng.
- **Expected:** chặn đặt và báo thiếu số đo (fail closed).
- **Actual:** `if (completeness && !canOrder)` chỉ chạy khi có data; loading/error cho qua, chỉ còn server chặn.
- **Evidence:** `CheckoutScreen.tsx:559`, `:725`; `use-measurements-completeness.ts:31`.
- **Root cause:** Guard phụ thuộc truthiness của query data.
- **Resolution:** Chưa sửa.

## BUG-025 — Món không khả dụng vẫn vào quote/order nhưng bị loại khỏi tổng giỏ

- **Severity:** High · **Priority:** P1 · **Status:** Open (defect candidate)
- **Related:** US-011 / AC-037 / BR-044 / SCR-017, SCR-018
- **Reproduction:** giỏ có dòng `available=false`; mở Checkout.
- **Expected:** món không bán bị loại khỏi payload/tổng, khớp BR-043 của BE.
- **Actual:** quote/order gửi toàn bộ `cart.items`; tổng giỏ dùng `getTotalPrice` lại bỏ qua `available===false` → tổng hiển thị và payload lệch nhau.
- **Evidence:** `CheckoutScreen.tsx:356-361`, `:1051-1079`; `use-cart.ts:getTotalPrice:359-367`.
- **Root cause:** Hai nguồn lọc khác nhau giữa cart summary và checkout.
- **Resolution:** Chưa sửa.

## BUG-026 — OrderSuccess báo “chưa thành công” sau 20s dù IPN có thể còn đến

- **Severity:** Medium · **Priority:** P2 · **Status:** Open (defect candidate)
- **Related:** US-012 / AC-042 / BR-061 / SCR-024 / TC-066
- **Reproduction:** vào OrderSuccess khi payment còn PENDING; không có IPN trong 20s.
- **Expected:** trạng thái “đang chờ xác nhận”, có thể tiếp tục kiểm tra; không khẳng định thất bại.
- **Actual:** `confirmTimedOut` → card “Thanh toán chưa thành công”.
- **Evidence:** `OrderSuccessScreen.tsx:15-16`, `:38-51`, `:97-108`.
- **Root cause:** Timeout UI bị dùng như kết luận nghiệp vụ.
- **Resolution:** Chưa sửa.

## BUG-027 — Báo chưa nhận tiền hoàn luôn gắn vào item đầu tiên

- **Severity:** Medium · **Priority:** P2 · **Status:** Open (defect candidate)
- **Related:** US-017 / AC-056 / BR-074 / SCR-022
- **Reproduction:** đơn nhiều item, refund COMPLETED; mở OrderReturns → “Chưa nhận được tiền hoàn”.
- **Expected:** chọn đúng item/refund liên quan hoặc gửi issue ở cấp đơn.
- **Actual:** `order.items?.[0]` được dùng làm `orderItemId` cho mọi báo cáo.
- **Evidence:** `OrderReturnsScreen.tsx:142-148`; `ReportIssueModal` nhận `item`.
- **Root cause:** Tái dùng form issue theo item cho báo cáo cấp đơn.
- **Resolution:** Chưa sửa.

## BUG-028 — Scheme deep link không khớp

- **Severity:** Low · **Priority:** P3 · **Status:** Open (defect candidate)
- **Related:** US-012 / AC-040 / BR-080 / SCR-019 / TC-089
- **Evidence:** app scheme `fashionaimobile` (`app.json:9`, `env.ts:5`) vs heuristic `fashionai://payment/*` (`PaymentScreen.tsx:386,397,407`); không có global deep-link handler (`root-navigator.tsx:55`).
- **Expected/Actual:** URL `fashionai://payment/success` không do app phát; nhánh không bao giờ chạy.
- **Resolution:** Chưa sửa.

## BUG-029 — Stepper giỏ không chặn trần số lượng

- **Severity:** Low · **Priority:** P2 · **Status:** Open (defect candidate)
- **Related:** US-011 / AC-037 / BR-044 / SCR-017
- **Evidence:** `CartScreen.tsx:238-253`; `use-cart.ts:308-325`; BE BR-043 giới hạn 1…1000.
- **Expected/Actual:** client cho tăng vô hạn; chỉ server từ chối/kẹp.
- **Resolution:** Chưa sửa.

## BUG-030 — Nút “Chưa nhận được tiền hoàn” ở chi tiết đơn không kiểm tra cửa sổ 7 ngày

- **Severity:** Low · **Priority:** P3 · **Status:** Open (defect candidate)
- **Related:** US-017 / AC-057 / BR-074 / SCR-021
- **Evidence:** `OrderDetailScreen.tsx:911-945` hiện nút khi `refundStatus=COMPLETED`; `OrderReturnsScreen` mới là nơi ẩn theo `canReportRefundNotReceived` (`order-returns.ts:73-85`).
- **Expected/Actual:** khách quá 7 ngày vẫn mở được màn đích nhưng không có hành động → vòng lặp UI.
- **Resolution:** Chưa sửa.

## BUG-031 — Tracking không được làm mới qua endpoint riêng

- **Severity:** Low · **Priority:** P3 · **Status:** Open (defect candidate)
- **Related:** US-013 / AC-045 / BR-069 / SCR-021
- **Evidence:** `ordersApi.getTracking` (`orders.api.ts:132-134`) không có caller; UI đọc `trackingUrl`/`currentShipment` từ `GET /orders/:id` (`OrderDetailScreen.tsx:555-558`) và chỉ refresh theo 30s của order.
- **Expected/Actual:** tracking có thể cũ hoặc thiếu link khi order payload không nhúng shipment.
- **Resolution:** Chưa sửa.

## BUG-032 — Từ chối quyền thư viện ảnh không có phản hồi

- **Severity:** Low · **Priority:** P3 · **Status:** Open (defect candidate)
- **Related:** US-016 / AC-054 / BR-073 / SCR-022 / TC-086
- **Evidence:** `evidence-images.ts:pickEvidenceImages:49-64` trả `cancelled:true` khi permission denied/lỗi; caller return im lặng (`ReportIssueModal.tsx:138-140`, `DeliveryDisputeModal.tsx:83-85`).
- **Expected/Actual:** người dùng không biết vì sao không thêm được ảnh.
- **Resolution:** Chưa sửa.

## Tổng hợp

| Severity | Số lượng | ID |
|---|---|---|
| Critical | 0 | — |
| High | 4 | BUG-022, BUG-023, BUG-024, BUG-025 |
| Medium | 2 | BUG-026, BUG-027 |
| Low | 5 | BUG-028…BUG-032 |
