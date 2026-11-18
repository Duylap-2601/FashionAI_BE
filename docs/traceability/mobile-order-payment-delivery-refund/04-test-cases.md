# Test scenarios & cases — FLW-002 (mobile)

Nguyên tắc: TC suy từ US/AC/BR và hợp đồng API, không suy từ happy path. `Status` chỉ chuyển `PASS` khi có `EXEC` tương ứng trong `05-execution.md`. Môi trường thực thi: Jest unit/contract của mobile, không phải E2E thiết bị.

## TS-007 — Giỏ, quote, địa chỉ, số đo

### TC-051 — Hợp đồng API giỏ hàng
- **Related:** US-011 / AC-037 / BR-044 / SCR-017
- **Type:** Positive + Validation
- **Priority:** P1
- **Preconditions:** axios mock.
- **Test data:** cart id, productId UUID, quantity 2.
- **Actions:** GET `/cart`; POST `/cart/items`; PATCH; DELETE item; DELETE cart; POST `/cart/merge`.
- **Expected:** đúng method/path/body; UUID không hợp lệ bị chặn trước khi gọi.
- **Automation:** Yes (Jest) — `src/features/cart/api/cart.api.test.ts` (8 test)
- **Status:** PASS (EXEC-018)

### TC-052 — Tách tạm tính và giảm sale
- **Related:** US-011 / AC-037 / BR-050 / SCR-018
- **Type:** Calculation + Boundary
- **Priority:** P1
- **Test data:** quote có/không `listItemsTotal`; sale 0; list < items.
- **Actions:** gọi `getCheckoutSubtotal`.
- **Expected:** tổng các dòng bằng `totalAmount`; không có sale âm; fallback subtotal giỏ.
- **Automation:** Yes — `checkout-display.test.ts` (7 test)
- **Status:** PASS (EXEC-019)

### TC-053 — Chặn đặt khi quote hết hạn/đổi
- **Related:** US-011 / AC-039 / BR-045, BR-081 / SCR-018
- **Type:** Error
- **Priority:** P0
- **Preconditions:** order create trả `QUOTE_EXPIRED`/`QUOTE_CHANGED`.
- **Actions:** bấm Đặt hàng.
- **Expected:** không tạo đơn; refetch quote; Alert “Báo giá đã thay đổi”.
- **Automation:** Yes (component) — chưa có test
- **Status:** Not Run

### TC-054 — Xung đột version địa chỉ
- **Related:** US-011 / AC-039 / BR-046 / SCR-018
- **Type:** Error
- **Priority:** P1
- **Preconditions:** quote trả `ADDRESS_VERSION_CONFLICT`.
- **Actions:** bấm Đặt hàng hoặc retry quote.
- **Expected:** refetch sổ địa chỉ + quote; chặn đặt; thông báo địa chỉ đổi.
- **Automation:** Yes
- **Status:** Not Run

### TC-055 — Thiếu số đo phải chặn ở client
- **Related:** US-011 / AC-038 / BR-047 / SCR-018
- **Type:** Negative
- **Priority:** P0
- **Preconditions:** completeness `canOrder=false`.
- **Actions:** bấm Đặt hàng.
- **Expected:** không gọi `/orders`; hiện danh sách số đo thiếu.
- **Actual (code):** gate chỉ chạy khi `completeness` truthy; lúc loading/lỗi gate bị bỏ → BUG-024.
- **Automation:** Yes
- **Status:** Not Run

### TC-056 — Coupon lỗi vẫn giữ quote gốc
- **Related:** US-011 / AC-037 / BR-049 / SCR-018
- **Type:** Error
- **Priority:** P2
- **Preconditions:** quote kèm coupon trả lỗi coupon.
- **Actions:** áp coupon.
- **Expected:** quote không coupon vẫn hiển thị; `couponError` hiện riêng.
- **Automation:** No
- **Status:** Not Run

## TS-008 — Tạo đơn và link thanh toán

### TC-057 — Hợp đồng API đơn hàng
- **Related:** US-011, US-013, US-014 / AC-039, AC-043, AC-046 / BR-064, BR-066, BR-081 / SCR-018
- **Type:** Positive
- **Priority:** P0
- **Actions:** quote; create; list; detail; cancel; confirm delivery; my returns; issues; refund confirm; dispute; create issue.
- **Expected:** đúng path/body/params; paging/`meta` được chuẩn hoá.
- **Automation:** Yes — `orders.api.test.ts` (13 test)
- **Status:** PASS (EXEC-020)

### TC-058 — Retry tạo đơn không được tạo trùng
- **Related:** US-011 / AC-039 / BR-053 / SCR-018
- **Type:** Regression
- **Priority:** P0
- **Preconditions:** BE đã tạo đơn nhưng response mất.
- **Actions:** bấm Đặt hàng lần hai.
- **Expected:** cùng idempotency key trả đơn cũ, không tạo đơn mới.
- **Actual (code):** mobile không gửi key → BUG-023.
- **Automation:** Yes
- **Status:** Not Run

### TC-059 — Hợp đồng API checkout thanh toán
- **Related:** US-012 / AC-040 / BR-055 / SCR-019
- **Type:** Positive
- **Priority:** P0
- **Actions:** POST `/payments/checkout` với orderId+provider; GET `/payments/:id`.
- **Expected:** trả `checkoutUrl`/`payUrl`/`qrCode`/`paymentId`; status đọc đúng.
- **Automation:** Yes — `payments.api.test.ts` (2 test)
- **Status:** PASS (EXEC-021)

### TC-060 — Chuyển từ tạo đơn sang Payment
- **Related:** US-012 / AC-040 / BR-055 / SCR-018, SCR-019
- **Type:** Integration
- **Priority:** P0
- **Preconditions:** create + checkout thành công.
- **Actions:** bấm Đặt hàng.
- **Expected:** `navigate('Payment', { checkoutUrl, provider, qrCode, orderCode, totalAmount, paymentId, orderId })`.
- **Automation:** Yes (component)
- **Status:** Not Run

### TC-061 — Nhắc đơn chưa thanh toán
- **Related:** US-011 / AC-037 / BR-051 / SCR-018
- **Type:** Boundary
- **Priority:** P1
- **Preconditions:** có >5 đơn CREATED PENDING.
- **Actions:** mở Checkout.
- **Expected:** chỉ lấy 5, lọc CREATED+PENDING, hiện hạn thanh toán.
- **Automation:** Yes — `orders.api.test.ts` nhóm `getUnpaidOrders` (3 test)
- **Status:** PASS (EXEC-022)

## TS-009 — Kết quả thanh toán

### TC-062 — ZaloPay poll tới trạng thái kết thúc
- **Related:** US-012 / AC-040 / BR-057 / SCR-019
- **Type:** State
- **Priority:** P0
- **Preconditions:** payment PENDING → PAID.
- **Actions:** mở PaymentScreen, chờ poll.
- **Expected:** gọi lại mỗi 3s; dừng ở PAID/FAILED/EXPIRED/REFUND_REQUIRED.
- **Automation:** Yes
- **Status:** Not Run

### TC-063 — URL “success” của cổng không được tự coi là PAID
- **Related:** US-012 / AC-040 / BR-056 / SCR-019
- **Type:** Negative/Security
- **Priority:** P0
- **Preconditions:** payment còn PENDING; URL chứa `success_url` hoặc `/success`.
- **Actions:** WebView load URL.
- **Expected:** vẫn chờ backend; không chuyển OrderSuccess.
- **Actual (code):** chuyển ngay khi URL chứa “success” → BUG-022.
- **Automation:** Yes
- **Status:** Not Run

### TC-064 — Nhãn/kết quả thanh toán
- **Related:** US-012 / AC-040, AC-041 / BR-058 / SCR-019
- **Type:** Boundary
- **Priority:** P1
- **Test data:** PAID, PENDING, FAILED, EXPIRED, CANCELLED, REFUND_REQUIRED, thiếu mã.
- **Actions:** gọi `getPaymentConfirmState`/`getPaymentDisplay`.
- **Expected:** PAID chỉ khi backend PAID; cancel/failed/expired đúng nhãn; không hiện mã rỗng.
- **Automation:** Yes — `payment-display.test.ts` (6 test)
- **Status:** PASS (EXEC-023)

### TC-065 — Success chỉ xử lý một lần
- **Related:** US-012 / AC-042 / BR-060 / SCR-019
- **Type:** Regression
- **Priority:** P1
- **Preconditions:** poll và WebView cùng báo PAID.
- **Actions:** hai tín hiệu liên tiếp.
- **Expected:** chỉ một `navigation.replace`.
- **Automation:** Yes
- **Status:** Not Run

### TC-066 — OrderSuccess poll 2s và timeout 20s
- **Related:** US-012 / AC-042 / BR-061 / SCR-024
- **Type:** State
- **Priority:** P1
- **Preconditions:** order CREATED.
- **Actions:** vào OrderSuccess, không có IPN.
- **Expected:** refetch 2s; sau 20s hiện “chưa thành công” nhưng không khẳng định PAID.
- **Automation:** Yes
- **Status:** Not Run

### TC-067 — Làm mới giỏ sau OrderSuccess
- **Related:** US-012 / AC-042 / BR-062 / SCR-024
- **Type:** Consistency
- **Priority:** P2
- **Actions:** mount OrderSuccess khi đã đăng nhập/chưa đăng nhập.
- **Expected:** refresh cart hoặc clear local; không crash.
- **Automation:** Yes
- **Status:** Not Run

## TS-010 — Danh sách, chi tiết, giao hàng

### TC-068 — Lọc/tìm đơn và phân trang
- **Related:** US-013 / AC-043 / BR-064 / SCR-020
- **Type:** Positive + Boundary
- **Priority:** P1
- **Actions:** chọn từng tab; nhập search; cuộn trang.
- **Expected:** status đúng; limit 20; meta chuẩn hoá khi thiếu.
- **Automation:** Yes — `orders.api.test.ts` (`getOrdersPage`)
- **Status:** PASS (EXEC-024)

### TC-069 — Refetch chi tiết theo terminal/app state
- **Related:** US-013 / AC-044 / BR-065 / SCR-021
- **Type:** State
- **Priority:** P1
- **Preconditions:** order SHIPPING; app active/background.
- **Actions:** mở chi tiết, chờ 30s.
- **Expected:** refetch khi active; dừng ở COMPLETED/CANCELLED/EXPIRED/FAILED và khi background.
- **Automation:** Yes
- **Status:** Not Run

### TC-070 — Hủy/xác nhận chỉ khi server cho phép
- **Related:** US-014, US-015 / AC-046…AC-048 / BR-066 / SCR-021
- **Type:** Auth/State
- **Priority:** P0
- **Test data:** `allowedActions` true/false.
- **Actions:** render chi tiết; bấm nút.
- **Expected:** nút ẩn khi false; gọi đúng API khi true và refetch.
- **Automation:** Yes
- **Status:** Not Run

### TC-071 — Validate tranh chấp chưa nhận
- **Related:** US-015 / AC-049 / BR-067 / SCR-021
- **Type:** Validation + Boundary
- **Priority:** P1
- **Test data:** mô tả 9/10/2000/2001 ký tự; 0/5/6 ảnh; ảnh 10MB.
- **Actions:** gửi form.
- **Expected:** 9 ký tự chặn; 10 cho; >2000 chặn; ảnh vượt bị loại kèm thông báo.
- **Automation:** Yes
- **Status:** Not Run

### TC-072 — Nhãn tracking ưu tiên GHN
- **Related:** US-013 / AC-045 / BR-069 / SCR-021
- **Type:** Positive
- **Priority:** P2
- **Test data:** rawStatus + normalized + order status.
- **Actions:** `getShippingLabel`.
- **Expected:** raw > normalized > text; không dùng nhãn order.
- **Automation:** Yes — `order-shipping.test.ts` (5 test)
- **Status:** PASS (EXEC-025)

### TC-073 — Mã đơn và nhãn thanh toán
- **Related:** US-012, US-013 / AC-040 / BR-058 / SCR-021
- **Type:** Positive
- **Priority:** P2
- **Actions:** format order code/total/payment label.
- **Expected:** `ORD-<code>`; 0 giữ nguyên; decimal string đọc được; ưu tiên provider đã trả.
- **Automation:** Yes — `order-format.test.ts` (4 test)
- **Status:** PASS (EXEC-026)

### TC-074 — Gọi xác nhận đã nhận hàng
- **Related:** US-015 / AC-048 / BR-066 / SCR-021
- **Type:** Positive
- **Priority:** P0
- **Actions:** bấm xác nhận.
- **Expected:** POST `/orders/:id/confirm-delivery`.
- **Automation:** Yes — `orders.api.test.ts` (`confirmDelivery`)
- **Status:** PASS (EXEC-027)

## TS-011 — Đổi trả, issue, hoàn tiền

### TC-075 — Cửa sổ báo lỗi 7 ngày và trạng thái
- **Related:** US-016 / AC-051, AC-052 / BR-070 / SCR-022
- **Type:** Boundary + State
- **Priority:** P0
- **Test data:** COMPLETED đúng 7 ngày/7 ngày + 1ms; CREATED/PAID/TAILORING/SHIPPING/DELIVERED/CANCELLED/RETURNED; history có/không COMPLETED.
- **Actions:** `canReportOrderIssue`.
- **Expected:** đúng biên; return-flow vẫn cho; trạng thái khác chặn.
- **Automation:** Yes — `order-returns.test.ts` (suite 28 test)
- **Status:** PASS (EXEC-028)

### TC-076 — Giới hạn ảnh minh chứng
- **Related:** US-016 / AC-054 / BR-073 / SCR-022
- **Type:** Boundary
- **Priority:** P1
- **Test data:** ảnh >10MB; sai MIME; 5/10/11 ảnh.
- **Actions:** `pickEvidenceImages`; `describeEvidenceRejection`.
- **Expected:** loại đúng, thông báo đúng surface.
- **Automation:** Yes — `evidence-images.test.ts` (2 test)
- **Status:** PASS (EXEC-029)

### TC-077 — Một issue chặn mỗi item
- **Related:** US-016 / AC-051 / BR-071 / SCR-022
- **Type:** State
- **Priority:** P1
- **Test data:** issue PENDING/APPROVED/RESOLVED/REJECTED.
- **Actions:** `getBlockedReportItemIds`.
- **Expected:** 3 trạng thái đầu chặn; REJECTED không.
- **Automation:** Yes — `order-returns.test.ts`
- **Status:** PASS (EXEC-030)

### TC-078 — Validate form issue
- **Related:** US-016 / AC-053 / BR-072 / SCR-022
- **Type:** Validation + Boundary
- **Priority:** P0
- **Test data:** mô tả 9/10/2000/2001; 0 ảnh; STK 5/6/20/21 chữ số; thiếu bank/holder.
- **Actions:** `validateIssueForm`.
- **Expected:** đúng câu lỗi đầu tiên; đủ điều kiện trả null.
- **Automation:** Yes — `order-returns.test.ts` (6 test)
- **Status:** PASS (EXEC-031)

### TC-079 — Điều kiện báo chưa nhận tiền hoàn
- **Related:** US-017 / AC-056, AC-057 / BR-074 / SCR-022
- **Type:** Boundary + State
- **Priority:** P0
- **Test data:** refund COMPLETED trong/quá 7 ngày; không refund; issue PENDING/APPROVED đã có.
- **Actions:** `canReportRefundNotReceived`; `hasOpenRefundNotReceivedIssue`.
- **Expected:** chỉ mở khi đủ điều kiện; issue mở chặn lặp.
- **Automation:** Yes — `order-returns.test.ts` (5 test)
- **Status:** PASS (EXEC-032)

### TC-080 — Hiển thị chứng từ hoàn tiền
- **Related:** US-017 / AC-055 / BR-076 / SCR-022
- **Type:** Error handling
- **Priority:** P2
- **Test data:** evidence string/object/array/unknown keys/rỗng.
- **Actions:** `formatRefundEvidence`, `getRefundEvidenceImages`.
- **Expected:** đọc reference/note/transactionId/message/receiptUrl; không in raw object; ảnh tách riêng.
- **Automation:** Yes — `order-returns.test.ts`
- **Status:** PASS (EXEC-033)

### TC-081 — Timeline đổi trả
- **Related:** US-016, US-017 / AC-056 / BR-076 / SCR-022
- **Type:** Positive
- **Priority:** P2
- **Actions:** `isReturnHistoryEvent` với event ISSUE/REFUND/RETURN.
- **Expected:** chỉ giữ event liên quan; fallback `updatedAt`.
- **Automation:** Yes — `order-returns.test.ts`
- **Status:** PASS (EXEC-034)

### TC-082 — Danh sách đổi trả phân trang
- **Related:** US-017 / AC-057 / BR-077 / SCR-023
- **Type:** Positive + Boundary
- **Priority:** P1
- **Actions:** gọi `getMyReturns` với/không meta.
- **Expected:** page/limit 10; thiếu meta vẫn trả trang hiện tại.
- **Automation:** Yes — `orders.api.test.ts`
- **Status:** PASS (EXEC-035)

### TC-083 — Multipart tạo issue
- **Related:** US-016 / AC-053 / BR-072 / SCR-022
- **Type:** Integration
- **Priority:** P0
- **Actions:** `createOrderIssue` mode PRODUCT/REFUND_NOT_RECEIVED.
- **Expected:** multipart đúng field, `desiredResolution=REFUND`, ảnh + bank đúng mode.
- **Automation:** Yes — `orders.api.test.ts` (`createOrderIssue`)
- **Status:** PASS (EXEC-036)

### TC-084 — Xác nhận đã nhận tiền hoàn
- **Related:** US-017 / AC-055 / BR-075 / SCR-021
- **Type:** Positive
- **Priority:** P0
- **Actions:** gọi `confirmRefundReceived`.
- **Expected:** POST `/orders/:id/refund/confirm-received`.
- **Automation:** Yes — `orders.api.test.ts`
- **Status:** PASS (EXEC-037)

### TC-085 — UI form issue và nút gửi
- **Related:** US-016 / AC-053, AC-054 / BR-072, BR-073 / SCR-022
- **Type:** UI
- **Priority:** P1
- **Actions:** render modal, nhập thiếu/đủ, chọn ảnh.
- **Expected:** disable đúng lúc; thông báo lỗi hiển thị; ảnh preview/xoá được.
- **Automation:** Yes (RNTL)
- **Status:** Not Run

### TC-086 — Từ chối quyền thư viện ảnh
- **Related:** US-016 / AC-054 / BR-073 / SCR-022
- **Type:** Error
- **Priority:** P2
- **Preconditions:** permission denied.
- **Actions:** bấm thêm ảnh.
- **Expected:** có thông báo lý do; không im lặng.
- **Actual (code):** im lặng → 09-audit.
- **Automation:** Yes
- **Status:** Not Run

## TS-012 — Nền tảng

### TC-087 — Điều hướng từ thông báo
- **Related:** US-018 / AC-058…AC-060 / BR-079 / SCR-025
- **Type:** Positive + Error
- **Priority:** P1
- **Test data:** issue review, refund payment, issue không order, order status, chat, loại lạ.
- **Actions:** `resolveOrderNotificationTarget`.
- **Expected:** đúng route/params; loại lạ trả null.
- **Automation:** Yes — `order-notification-target.test.ts` (6 test)
- **Status:** PASS (EXEC-038)

### TC-088 — Refresh JWT một lần
- **Related:** US-011…US-018 / BR-078 / SCR-017…SCR-025
- **Type:** Auth
- **Priority:** P0
- **Preconditions:** 401 `ACCESS_TOKEN_EXPIRED`.
- **Actions:** gọi API; refresh thành công/thất bại.
- **Expected:** retry đúng một lần; refresh lỗi clear token + logout; request song song dùng chung promise.
- **Automation:** Yes — `auth.api.test.ts`
- **Status:** Not Run (không nằm trong lần chạy 13 suite)

### TC-089 — URL heuristic và scheme deep link
- **Related:** US-012 / AC-040 / BR-056, BR-080 / SCR-019
- **Type:** Negative
- **Priority:** P1
- **Test data:** `https://...?success_url=...`, `fashionai://payment/success`, `fashionaimobile://...`.
- **Actions:** `handleWebViewNavigation`.
- **Expected:** URL chứa success_url không kích hoạt PAID; scheme dò khớp app.
- **Actual (code):** cả hai sai → BUG-022, BUG-028.
- **Automation:** Yes
- **Status:** Not Run

### TC-090 — Ghi chú đang chờ quote thì chặn đặt
- **Related:** US-011 / AC-037 / BR-048 / SCR-018
- **Type:** Consistency
- **Priority:** P2
- **Preconditions:** người dùng sửa ghi chú giao hàng.
- **Actions:** bấm Đặt hàng trong khoảng debounce 600ms.
- **Expected:** nút disable (“Đang cập nhật tổng tiền…”); không gửi order với quote cũ.
- **Automation:** Yes (component)
- **Status:** Not Run

### TC-091 — Sau PAID, nội dung đơn chuyển duyệt số đo
- **Related:** US-012 / AC-042 / BR-063 / SCR-024
- **Type:** Positive
- **Priority:** P2
- **Preconditions:** order PAID.
- **Actions:** mở OrderSuccess.
- **Expected:** card “Thanh toán thành công”, mô tả chuyển bước duyệt số đo; “Xem đơn hàng” mở OrderDetail.
- **Automation:** Yes (component)
- **Status:** Not Run

### TC-092 — Tranh chấp OPEN không cho mở tranh chấp mới
- **Related:** US-015 / AC-050 / BR-068 / SCR-021
- **Type:** State
- **Priority:** P1
- **Preconditions:** `deliveryDispute.status=OPEN`.
- **Actions:** mở OrderDetail.
- **Expected:** hiện mô tả/ảnh/thời điểm; không có nút mở tranh chấp mới.
- **Automation:** Yes (component)
- **Status:** Not Run
