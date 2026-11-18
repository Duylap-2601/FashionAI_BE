# Business rules — FLW-002 (mobile)

Mỗi rule nêu hành vi mobile. Luật server đã có trong bộ `checkout-to-delivery` (FLW-001) và được tham chiếu, không nhân bản. `Intended` lấy từ tài liệu BE/traceability; `Enforced` lấy từ code mobile.

## Nhóm A — Giá, quote, địa chỉ

### BR-044 — Tổng tiền cuối cùng do server quyết định
- **Statement:** Mobile chỉ hiển thị `itemsTotal`, `shippingFee`, `discountAmount`, `totalAmount` từ `POST /orders/quote`; không tự tính tổng để đặt hàng.
- **Type:** Calculation
- **Condition:** Checkout có quote thành công.
- **Expected behavior:** `displayTotal = quote.totalAmount`; trước quote dùng tạm tính giỏ cho phần hiển thị.
- **Exception:** Không có.
- **Related:** US-011 / AC-037
- **Enforcement point:** `FE_Mobile src/features/checkout/screens/CheckoutScreen.tsx:quoteRes:399`; `.../utils/checkout-display.ts:getCheckoutSubtotal:18`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-045 — Chặn đặt hàng khi quote chưa sẵn sàng
- **Statement:** Chỉ gọi tạo đơn khi có quote hợp lệ, không đang fetch và ghi chú đã đồng bộ.
- **Type:** Workflow
- **Condition:** `quoteReady && !isQuoting && !isNotePending`.
- **Expected behavior:** Nút “Đặt hàng” disable; `handlePlaceOrder` còn kiểm tra lại và alert nếu thiếu.
- **Exception:** Quote lỗi → hiện lỗi và nút refetch.
- **Related:** US-011 / AC-037, AC-039
- **Enforcement point:** `CheckoutScreen.tsx:canPlaceOrder:669`; `:handlePlaceOrder:545`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-046 — Địa chỉ giao hàng phải là địa chỉ đã lưu có version hoặc địa chỉ GHN 2 cấp
- **Statement:** Quote gửi `shippingAddressId + addressVersion` cho địa chỉ đã lưu, hoặc `shippingInfo` có `ghnProvinceV3Id`/`ghnWardV3Id` cho địa chỉ nhập mới.
- **Type:** Validation
- **Condition:** Có địa chỉ được chọn/nhập.
- **Expected behavior:** `ADDRESS_VERSION_CONFLICT` hoặc `ADDRESS_INVALID` → refetch sổ địa chỉ + quote, chặn đặt.
- **Exception:** Không có địa chỉ → alert “Thiếu địa chỉ”.
- **Related:** US-011 / AC-037, AC-039
- **Enforcement point:** `CheckoutScreen.tsx:quoteAddress:329`; `:handleRetryQuote`; `:handlePlaceOrder:546`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-047 — Cổng số đo chặn đặt hàng
- **Statement:** Nếu `completeness.canOrder=false`, mobile không tạo đơn và liệt kê số đo thiếu theo category.
- **Type:** Validation
- **Condition:** `useMeasurementsCompleteness` trả `canOrder=false`.
- **Expected behavior:** Alert/khối “Bổ sung số đo”; nút đặt bị chặn.
- **Exception:** API completeness lỗi → `canOrder` mặc định false (fail closed).
- **Related:** US-011 / AC-038
- **Enforcement point:** `CheckoutScreen.tsx:436`; `:handlePlaceOrder:559`; `measurementsGate:725`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-048 — Ghi chú giao hàng debounce trước khi quote lại
- **Statement:** Ghi chú được đợi `NOTE_QUOTE_DELAY_MS` rồi mới đưa vào quote; khi ghi chú chưa khớp quote hiện tại thì chặn đặt.
- **Type:** Consistency
- **Condition:** `shippingNote !== quoteNote`.
- **Expected behavior:** Nút hiện “Đang cập nhật tổng tiền…”, `canPlaceOrder=false`.
- **Exception:** Không có.
- **Related:** US-011 / AC-037
- **Enforcement point:** `CheckoutScreen.tsx:314`; `:isNotePending:420`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-049 — Coupon chỉ áp qua quote, lỗi coupon không chặn giá gốc
- **Statement:** Khi áp coupon, mobile gọi quote kèm `couponCode`; nếu coupon lỗi, vẫn giữ quote không coupon và hiện `couponError`.
- **Type:** Calculation
- **Condition:** Người dùng nhập coupon.
- **Expected behavior:** Tổng tiền luôn có nguồn server; coupon lỗi không làm mất quote hợp lệ.
- **Exception:** Quote không coupon cũng lỗi → hiện lỗi quote.
- **Related:** US-011 / AC-037
- **Enforcement point:** `CheckoutScreen.tsx:quoteQuery:342-384`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-050 — Hiển thị tạm tính và giảm sale khớp tổng
- **Statement:** “Tạm tính” = giá niêm yết; “Giảm giá sale” = `listItemsTotal − itemsTotal` (không âm); tổng các dòng bằng `totalAmount`.
- **Type:** Calculation
- **Condition:** Quote có `listItemsTotal`.
- **Expected behavior:** Không hiện dòng sale khi chênh lệch 0/không có dữ liệu.
- **Exception:** `listItemsTotal < itemsTotal` → sale = 0.
- **Related:** US-011 / AC-037
- **Enforcement point:** `checkout-display.ts:getCheckoutSubtotal:18-26`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-052

### BR-051 — Cảnh báo đơn chưa thanh toán trước khi tạo đơn mới
- **Statement:** Checkout hiển thị tối đa 5 đơn CREATED + payment PENDING của chính khách, kèm hạn thanh toán và lối thanh toán lại.
- **Type:** Workflow
- **Condition:** `useUnpaidOrders` trả dữ liệu.
- **Expected behavior:** Khối cảnh báo xuất hiện phía trên form; đơn cũ không bị tự hủy bởi mobile.
- **Exception:** Không có đơn → ẩn khối.
- **Related:** US-011 / AC-037
- **Enforcement point:** `CheckoutScreen.tsx:290`, `:969`; `orders.api.ts:UNPAID_ORDERS_LIMIT:72`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-052 — Gửi `paymentMethod` cố định khi tạo đơn
- **Statement:** Mobile tạo đơn với `paymentMethod='BANK_TRANSFER'`; provider thực tế (ZALOPAY/SEPAY) chỉ gửi ở bước checkout.
- **Type:** Integration
- **Condition:** Bấm đặt hàng.
- **Expected behavior:** BE nhận đơn online; không có COD từ mobile.
- **Exception:** Không có.
- **Related:** US-011, US-012 / AC-039, AC-040
- **Enforcement point:** `CheckoutScreen.tsx:handlePlaceOrder:~610`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-053 — Không gửi idempotency key khi tạo đơn
- **Statement:** BE hỗ trợ `idempotencyKey` trong body, nhưng mobile không sinh/gửi khóa; chống double-tap chỉ dựa vào disable nút.
- **Type:** Integration
- **Condition:** Mọi lần tạo đơn.
- **Expected behavior (intended):** Mỗi payload có idempotency key để retry không tạo đơn trùng.
- **Exception:** Mất phản hồi sau khi BE tạo đơn → retry tạo đơn thứ hai.
- **Related:** US-011 / AC-039
- **Enforcement point:** `CheckoutScreen.tsx:handlePlaceOrder`; `orders.api.ts:createOrder:92-94`; field khai báo nhưng không dùng `:41`
- **Intended / Enforced:** yes / no
- **Confidence:** High
- **Verification:** Code-verified → BUG-023

## Nhóm B — Thanh toán

### BR-054 — Chỉ hai provider được chọn
- **Statement:** UI thanh toán từ đơn chỉ cho ZaloPay và SePay; `WALLET` có trong enum nhưng không dùng ở flow này.
- **Type:** Workflow
- **Condition:** Mở PaymentMethodSheet.
- **Expected behavior:** Provider gửi lên là `'ZALOPAY' | 'SEPAY'`.
- **Exception:** Không có.
- **Related:** US-012 / AC-040
- **Enforcement point:** `OrderDetailScreen.tsx:handlePay:620-630`; `types/order.ts:EPaymentMethod:15`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-055 — Checkout thanh toán cần orderId + provider
- **Statement:** `POST /payments/checkout` chỉ được gọi sau khi tạo đơn thành công, với `paymentId`/URL trả về được chuyển sang PaymentScreen.
- **Type:** Integration
- **Condition:** Order CREATED.
- **Expected behavior:** Có `checkoutUrl` hoặc `payUrl`; thiếu URL → alert lỗi.
- **Exception:** Checkout API lỗi → alert “Lỗi đặt hàng”.
- **Related:** US-012 / AC-040
- **Enforcement point:** `CheckoutScreen.tsx:checkoutPaymentMutation:431`; `:handlePlaceOrder:626`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-056 — PAID phải do backend xác nhận
- **Statement:** UI chỉ được coi giao dịch thành công khi `GET /payments/:id` trả `PAID`/`COMPLETED`; URL của cổng không phải nguồn sự thật.
- **Type:** State
- **Condition:** PaymentScreen nhận tín hiệu từ poll hoặc WebView.
- **Expected behavior:** Chỉ `isPaid` từ query chuyển sang OrderSuccess.
- **Exception:** WebView URL chứa “success” → mobile hiện tại chuyển thành công ngay (vi phạm).
- **Related:** US-012 / AC-040, AC-042
- **Enforcement point:** `PaymentScreen.tsx:PAID_STATUSES:35`; `:handleWebViewNavigation:380-390` (nhánh success); `handlePaymentSuccess:250`
- **Intended / Enforced:** yes / no
- **Confidence:** High
- **Verification:** Code-verified → BUG-022

### BR-057 — Poll trạng thái thanh toán theo provider
- **Statement:** ZaloPay poll mỗi 3s khi status PENDING; gói thành viên poll mọi trạng thái chưa kết thúc; đơn SePay thường không poll.
- **Type:** Integration
- **Condition:** `shouldPollPaymentStatus`.
- **Expected behavior:** Dừng ở PAID/FAILED/EXPIRED/REFUND_REQUIRED.
- **Exception:** Đơn SePay thường phụ thuộc URL/refetch thủ công.
- **Related:** US-012 / AC-040
- **Enforcement point:** `PaymentScreen.tsx:shouldPollPaymentStatus:209`; `refetchInterval:213-241`
- **Intended / Enforced:** yes / yes (partial)
- **Confidence:** High
- **Verification:** Code-verified

### BR-058 — Bản đồ kết quả thanh toán
- **Statement:** PAID → OrderSuccess; CANCELLED → “Thanh toán đã bị hủy”; FAILED → thất bại; EXPIRED → hết hạn; REFUND_REQUIRED → cần hoàn tiền.
- **Type:** State
- **Condition:** Trạng thái/override tương ứng.
- **Expected behavior:** Mỗi trạng thái có màn riêng và đường tiếp theo (xem đơn/thử lại/về giỏ).
- **Exception:** Không có URL → “Không tìm thấy liên kết thanh toán”.
- **Related:** US-012 / AC-040, AC-041
- **Enforcement point:** `PaymentScreen.tsx:243-490`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-059 — “Hủy thanh toán” chỉ là trạng thái UI
- **Statement:** Bấm hủy trong PaymentScreen không gọi API hủy đơn/payment; chỉ đặt override CANCELLED. Đơn vẫn chờ thanh toán.
- **Type:** Workflow
- **Condition:** Người dùng bấm “Hủy thanh toán”.
- **Expected behavior:** Hiện result huỷ; hướng dẫn thanh toán lại từ chi tiết đơn.
- **Exception:** Không có.
- **Related:** US-012 / AC-041
- **Enforcement point:** `PaymentScreen.tsx:handleHoldOrder:365`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-060 — Success chỉ xử lý một lần
- **Statement:** Cờ `hasHandledResultRef` chặn poll/WebView/effect cùng chuyển màn hai lần.
- **Type:** Consistency
- **Condition:** Nhiều tín hiệu PAID.
- **Expected behavior:** Chỉ một `navigation.replace`.
- **Exception:** Không có.
- **Related:** US-012 / AC-042
- **Enforcement point:** `PaymentScreen.tsx:hasHandledResultRef:193`; `handlePaymentSuccess:250-256`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-061 — OrderSuccess xác nhận bằng đơn, không bằng URL
- **Statement:** Sau khi vào OrderSuccess, app poll `GET /orders/:id` 2s/lần tối đa 20s và chỉ báo thành công khi order PAID/COMPLETED.
- **Type:** State
- **Condition:** Order chưa PAID khi vừa vào.
- **Expected behavior:** “Đang xác nhận thanh toán”; quá 20s → “Chưa thành công”.
- **Exception:** Refetch lỗi → giữ trạng thái chờ đến timeout.
- **Related:** US-012 / AC-042
- **Enforcement point:** `OrderSuccessScreen.tsx:CONFIRM_TIMEOUT_MS:15`; `:38-51`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-062 — Giỏ được làm mới sau khi vào OrderSuccess
- **Statement:** Nếu đã đăng nhập, mobile refresh giỏ từ server; nếu không, xóa giỏ local.
- **Type:** Consistency
- **Condition:** Mount OrderSuccess.
- **Expected behavior:** Badge giỏ không còn món đã thanh toán.
- **Exception:** Refresh lỗi → giữ nguyên, không chặn màn.
- **Related:** US-012 / AC-042
- **Enforcement point:** `OrderSuccessScreen.tsx:26-34`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-063 — Đơn PAID chuyển bước duyệt số đo
- **Statement:** OrderSuccess mô tả đơn chuyển sang duyệt số đo trước khi may, khớp state machine BE.
- **Type:** Workflow
- **Condition:** Order PAID.
- **Expected behavior:** Nội dung “Đơn chuyển sang bước duyệt số đo”.
- **Exception:** Không có.
- **Related:** US-012 / AC-042
- **Enforcement point:** `OrderSuccessScreen.tsx:80`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + BE BR-021

## Nhóm C — Danh sách, chi tiết, giao hàng

### BR-064 — Tab danh sách ánh xạ trạng thái BE
- **Statement:** 9 tab gửi `status` tương ứng; tab “Tất cả” không gửi status; tìm kiếm debounce.
- **Type:** Workflow
- **Condition:** Chọn tab/nhập tìm kiếm.
- **Expected behavior:** `GET /orders?status=&search=&page=&limit=20`.
- **Exception:** API lỗi → trạng thái lỗi + thử lại.
- **Related:** US-013 / AC-043
- **Enforcement point:** `OrdersScreen.tsx:FILTER_TABS:43-54`; `:280`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-068

### BR-065 — Chi tiết đơn tự refresh có điều kiện
- **Statement:** Refetch 30s khi status chưa terminal và app active; terminal gồm COMPLETED/CANCELLED/EXPIRED/FAILED.
- **Type:** Consistency
- **Condition:** Mở OrderDetail.
- **Expected behavior:** Dữ liệu tự cập nhật; background thì dừng.
- **Exception:** Mất mạng → react-query giữ dữ liệu cũ.
- **Related:** US-013 / AC-044
- **Enforcement point:** `use-orders.ts:TERMINAL_ORDER_STATUSES:6`; `useOrder:62-77`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-066 — Hủy/xác nhận nhận hàng theo quyết định BE
- **Statement:** Mobile chỉ hiện nút khi `allowedActions.cancel` / `allowedActions.confirmDelivery` là true.
- **Type:** Authorization
- **Condition:** Render OrderDetail.
- **Expected behavior:** Không suy ra quyền từ status phía client.
- **Exception:** BE không trả `allowedActions` → ẩn nút.
- **Related:** US-014, US-015 / AC-046, AC-047, AC-048
- **Enforcement point:** `OrderDetailScreen.tsx:541-542`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-067 — Tranh chấp chưa nhận cần mô tả, ảnh là tùy chọn
- **Statement:** Dispute yêu cầu mô tả 10–2000 ký tự; tối đa 5 ảnh, mỗi ảnh <10MB, chỉ JPEG/PNG/WebP.
- **Type:** Validation
- **Condition:** Mở DeliveryDisputeModal.
- **Expected behavior:** Nút gửi disable khi mô tả <10; ảnh vượt hạn mức bị loại kèm thông báo.
- **Exception:** Mất mạng → hiện lỗi từ API.
- **Related:** US-015 / AC-049
- **Enforcement point:** `DeliveryDisputeModal.tsx:24-25`, `:79-80`, `:99`; `evidence-images.ts:MAX_DISPUTE_EVIDENCE_IMAGES:8`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-074

### BR-068 — Chỉ mở tranh chấp khi BE cho phép và chưa có tranh chấp mở
- **Statement:** Nút báo chưa nhận chỉ hiện khi `allowedActions.reportDeliveryIssue=true` và `deliveryDispute.status !== 'OPEN'`.
- **Type:** State
- **Condition:** OrderDetail.
- **Expected behavior:** Dispute OPEN hiển thị mô tả/ảnh, không có nút mở mới.
- **Exception:** Không có.
- **Related:** US-015 / AC-050
- **Enforcement point:** `OrderDetailScreen.tsx:836-837`, `:951-990`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-069 — Nhãn tracking ưu tiên trạng thái GHN gốc
- **Statement:** Hiển thị `rawStatus` nếu có, rồi `normalizedStatus`, rồi text; không dùng nhãn order để thay trạng thái vận chuyển.
- **Type:** Error handling
- **Condition:** Có dữ liệu shipment.
- **Expected behavior:** Nhãn GHN phản ánh đúng dữ liệu BE.
- **Exception:** Không có shipment → ẩn khối tracking.
- **Related:** US-013 / AC-045
- **Enforcement point:** `order-shipping.ts:getShippingLabel`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-072

## Nhóm D — Đổi trả, issue, hoàn tiền

### BR-070 — Cửa sổ báo lỗi 7 ngày
- **Statement:** Chỉ báo lỗi khi order COMPLETED hoặc đang RETURN_REQUESTED/RETURN_APPROVED/RETURNING, và trong 7 ngày kể từ COMPLETED gần nhất (fallback updatedAt/createdAt).
- **Type:** Workflow
- **Condition:** Mở chi tiết đơn.
- **Expected behavior:** Quá hạn → không có nút báo lỗi; đúng 7 ngày vẫn cho.
- **Exception:** Không đọc được mốc thời gian → cho phép (fail open).
- **Related:** US-016 / AC-051, AC-052
- **Enforcement point:** `order-returns.ts:ISSUE_WINDOW_MS:14`; `canReportOrderIssue:161-171`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-075…TC-079

### BR-071 — Một issue “đang chặn” cho mỗi item
- **Statement:** Item có issue PENDING/APPROVED/RESOLVED không được báo lỗi lại.
- **Type:** Constraint
- **Condition:** Render danh sách item.
- **Expected behavior:** Nút báo lỗi của item bị ẩn/disable.
- **Exception:** Issue REJECTED/CANCELLED không chặn.
- **Related:** US-016 / AC-051
- **Enforcement point:** `order-returns.ts:BLOCKING_ISSUE_STATUSES:129`; `getBlockedReportItemIds:173`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-082

### BR-072 — Form issue: mô tả, ảnh, STK
- **Statement:** Mô tả 10–2000 ký tự; ít nhất 1 ảnh; tối đa 10 ảnh; bankName bắt buộc; số tài khoản 6–20 chữ số; accountHolder bắt buộc.
- **Type:** Validation
- **Condition:** Gửi ReportIssueModal.
- **Expected behavior:** Trả lỗi đầu tiên tương ứng; nút gửi disable khi thiếu mô tả/ảnh.
- **Exception:** Mode REFUND_NOT_RECEIVED đổi câu lỗi ảnh.
- **Related:** US-016 / AC-053
- **Enforcement point:** `order-returns.ts:validateIssueForm:196-216`; `ReportIssueModal.tsx:155-160`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-083…TC-085

### BR-073 — Chuẩn hoá ảnh minh chứng
- **Statement:** Ảnh chọn từ thư viện được nén JPEG, resize width 1600, quality 0.7; loại ảnh >10MB hoặc sai MIME trước khi upload.
- **Type:** Constraint
- **Condition:** Chọn ảnh.
- **Expected behavior:** Số ảnh bị loại được báo; không upload ảnh không hợp lệ.
- **Exception:** Permission bị từ chối → không chọn được, không crash.
- **Related:** US-016 / AC-054
- **Enforcement point:** `evidence-images.ts:pickEvidenceImages:48-110`; `normalizeImage:27-42`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-086

### BR-074 — Báo chưa nhận tiền hoàn có điều kiện
- **Statement:** Chỉ mở khi `refundStatus=COMPLETED`, có refund COMPLETED trong 7 ngày gần nhất, và chưa có issue REFUND_NOT_RECEIVED đang mở.
- **Type:** Workflow
- **Condition:** Mở OrderReturns.
- **Expected behavior:** Nút “Chưa nhận được tiền hoàn” hiện/ẩn theo điều kiện; form điền sẵn STK của đơn.
- **Exception:** Thiếu mốc refund → ẩn.
- **Related:** US-017 / AC-056, AC-057
- **Enforcement point:** `order-returns.ts:canReportRefundNotReceived:73-85`; `hasOpenRefundNotReceivedIssue:87-93`; `OrderReturnsScreen.tsx:131`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-087…TC-089

### BR-075 — Xác nhận nhận tiền hoàn chỉ khi refund COMPLETED và chưa xác nhận
- **Statement:** Khối xác nhận chỉ hiện khi `refundStatus=COMPLETED`; nếu `refundConfirmedAt` đã có thì hiện thông báo thay vì nút.
- **Type:** State
- **Condition:** OrderDetail.
- **Expected behavior:** Bấm nút gọi `POST /orders/:id/refund/confirm-received`, refetch sau thành công.
- **Exception:** API lỗi → feedback lỗi, không đổi UI.
- **Related:** US-017 / AC-055
- **Enforcement point:** `OrderDetailScreen.tsx:911-945`; `use-orders.ts:useConfirmRefundReceived`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-076 — Hiển thị issue/refund và chứng từ
- **Statement:** OrderReturns hiển thị issue list, refund lines, timeline, STK và ảnh chứng từ; refund evidence đọc được từ object/string/array, không in raw object.
- **Type:** Error handling
- **Condition:** Có issue/refund.
- **Expected behavior:** Không crash với evidence lạ; ảnh chứng từ tách riêng khỏi text.
- **Exception:** Evidence rỗng → ẩn khối.
- **Related:** US-016, US-017 / AC-055, AC-056
- **Enforcement point:** `order-returns.ts:formatRefundEvidence:98-120`; `getRefundEvidenceImages`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-090, TC-091

### BR-077 — Danh sách “Đổi trả” chỉ gồm đơn có issue/refund/luồng trả
- **Statement:** `GET /order-issues/mine` phân trang 10, gộp các trang khi cuộn.
- **Type:** Workflow
- **Condition:** Mở tab Returns.
- **Expected behavior:** Danh sách chỉ đơn có đổi trả; empty state khi không có.
- **Exception:** API lỗi → lỗi + thử lại.
- **Related:** US-017 / AC-057
- **Enforcement point:** `use-orders.ts:useMyReturns:157-180`; `MyReturnsScreen.tsx:131`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

## Nhóm E — Nền tảng, xác thực, thông báo

### BR-078 — JWT bắt buộc và refresh một lần
- **Statement:** Request mang Bearer token; gặp 401 `ACCESS_TOKEN_EXPIRED` thì refresh và retry một lần; refresh lỗi → clear token + logout.
- **Type:** Authorization
- **Condition:** Mọi API flow.
- **Expected behavior:** Không lặp refresh vô hạn; request song song dùng chung một promise refresh.
- **Exception:** 401 khác code → không refresh.
- **Related:** US-011…US-018 / AC-037…AC-060
- **Enforcement point:** `src/api/client.ts:refreshAccessToken:54-77`, `:88-105`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-092

### BR-079 — Điều hướng thông báo theo loại
- **Statement:** Issue review/refund payment → `OrderReturns`; issue không order → `Returns`; order status/chat → `OrderDetail`; loại khác bỏ qua.
- **Type:** Workflow
- **Condition:** Bấm push/socket.
- **Expected behavior:** Đúng route/params; không mở màn không tồn tại.
- **Exception:** Thiếu `orderId` → fallback danh sách.
- **Related:** US-018 / AC-058…AC-060
- **Enforcement point:** `order-notification-target.ts:17-59`; `use-push-notifications.ts:94-136`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-087

### BR-080 — Scheme deep link của app
- **Statement:** App dùng scheme `fashionaimobile`; PaymentScreen lại dò `fashionai://payment/*` khi đọc URL cổng.
- **Type:** Integration
- **Condition:** Cổng trả URL theo scheme.
- **Expected behavior:** Scheme dò phải khớp scheme khai báo.
- **Exception:** URL `fashionai://payment/success` không bao giờ do app này phát.
- **Related:** US-012 / AC-040
- **Enforcement point:** `app.json:scheme:9`; `PaymentScreen.tsx:handleWebViewNavigation:386`
- **Intended / Enforced:** yes / no
- **Confidence:** High
- **Verification:** Code-verified → BUG-024

### BR-081 — Payload tạo đơn không chứa giá trị tính toán của client
- **Statement:** Mobile gửi `quoteToken` + `totalAmount` từ quote, cùng items/địa chỉ; không gửi giá tự tính.
- **Type:** Integration
- **Condition:** Tạo đơn.
- **Expected behavior:** BE đối chiếu quote token và tổng; lệch → từ chối.
- **Exception:** Quote hết hạn → refetch.
- **Related:** US-011 / AC-039
- **Enforcement point:** `CheckoutScreen.tsx:handlePlaceOrder:~600-615`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + BE BR-004/BR-005
