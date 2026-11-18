# US + AC — FLW-002 (mobile)

Nguồn: code mobile `FashionAI_Mobile` (commit `594f275`) và bộ luật BE `checkout-to-delivery` (FLW-001). Story không có tài liệu gốc cho mobile được đánh dấu `Inferred from existing implementation`.

## US-011 — Đặt hàng từ app

- **Actor:** Customer
- **Story:** As a customer, I want to review cart, address, measurements and server-calculated total, so that I can place an order without re-entering data or trusting a wrong price.
- **Description:** Checkout tổng hợp địa chỉ, coupon, ghi chú, cổng số đo và quote; chỉ cho đặt khi quote sẵn sàng.
- **Preconditions:** Đã đăng nhập, giỏ không rỗng, có địa chỉ GHN hợp lệ.
- **Postconditions:** Order CREATED; điều hướng sang Payment.
- **Priority:** P0
- **Source:** Inferred from `CheckoutScreen.tsx`, `CartScreen.tsx`
- **Confidence:** High
- **Related AC:** AC-037, AC-038, AC-039

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-037 | Giỏ có món | Mở Checkout | Tổng tiền hiển thị theo quote server; trước khi có quote dùng tạm tính giỏ và không hiện dòng sale | Unverified |
| AC-038 | Thiếu số đo bắt buộc | Bấm Đặt hàng | Hệ thống chặn, liệt kê số đo thiếu, không gọi tạo đơn | Unverified |
| AC-039 | Quote hết hạn hoặc tổng đã đổi | Bấm Đặt hàng | Không tạo đơn; refetch quote; hiện thông báo báo giá thay đổi | Unverified |

## US-012 — Thanh toán và nhận kết quả

- **Actor:** Customer
- **Story:** As a customer, I want to pay with ZaloPay or SePay and see only a server-confirmed result, so that I do not believe an order is paid when it is not.
- **Description:** PaymentScreen mở cổng, poll trạng thái (ZaloPay/gói), hiển thị result theo trạng thái thanh toán.
- **Preconditions:** Order vừa tạo, `paymentId`/`checkoutUrl` có sẵn.
- **Postconditions:** OrderSuccess khi PAID; hoặc result thất bại/huỷ/hết hạn/cần hoàn.
- **Priority:** P0
- **Source:** Inferred from `PaymentScreen.tsx`, `payments.api.ts`
- **Confidence:** High
- **Related AC:** AC-040, AC-041, AC-042

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-040 | Payment PENDING | Mở ZaloPay | Poll `GET /payments/:id` mỗi 3s khi còn PENDING; dừng ở PAID/FAILED/EXPIRED/REFUND_REQUIRED | Unverified |
| AC-041 | Cổng trả FAILED/EXPIRED | Poll hoặc URL trả lỗi | Hiện màn thất bại/hết hạn, có đường thử lại | Unverified |
| AC-042 | Order đã PAID | Mở OrderSuccess | Poll đơn tối đa 20s; chỉ báo thành công khi backend trả PAID/COMPLETED | Unverified |

## US-013 — Theo dõi đơn và giao hàng

- **Actor:** Customer
- **Story:** As a customer, I want to see order status and GHN tracking refresh automatically, so that I know where my order is.
- **Description:** OrdersScreen lọc theo tab; OrderDetail poll 30s khi đơn chưa kết thúc và app đang active.
- **Preconditions:** Có ít nhất một đơn.
- **Postconditions:** Trạng thái hiển thị khớp BE; tracking mở được.
- **Priority:** P1
- **Source:** Inferred from `OrdersScreen.tsx`, `OrderDetailScreen.tsx`, `use-orders.ts`
- **Confidence:** High
- **Related AC:** AC-043, AC-044, AC-045

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-043 | Danh sách đơn | Chọn tab “Đang giao” | Gửi `status=SHIPPING`, phân trang 20, hiển thị đúng nhãn | Unverified |
| AC-044 | Đơn chưa COMPLETED/CANCELLED/EXPIRED/FAILED | Mở OrderDetail | Refetch mỗi 30s khi app active; dừng khi terminal hoặc background | Unverified |
| AC-045 | Đơn có mã tracking | Bấm tracking | Mở URL GHN; nhãn ưu tiên trạng thái GHN gốc | Unverified |

## US-014 — Hủy đơn chưa thanh toán

- **Actor:** Customer
- **Story:** As a customer, I want to cancel while the order is still unpaid, so that I am not charged later.
- **Description:** Nút hủy chỉ hiện khi BE trả `allowedActions.cancel`.
- **Preconditions:** Order CREATED, payment chưa PAID.
- **Postconditions:** Order CANCELLED; danh sách/chi tiết refresh.
- **Priority:** P1
- **Source:** Inferred from `OrderDetailScreen.tsx`, BE BR-013
- **Confidence:** High
- **Related AC:** AC-046, AC-047

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-046 | `allowedActions.cancel=true` | Bấm Hủy và xác nhận | Gọi `PATCH /orders/:id/cancel`, hiện phản hồi thành công, refetch | Unverified |
| AC-047 | Đơn đã PAID/SHIPPING | Mở chi tiết | Không hiện nút hủy | Unverified |

## US-015 — Xác nhận đã nhận hoặc báo chưa nhận

- **Actor:** Customer
- **Story:** As a customer, I want to confirm delivery or dispute non-receipt, so that the order can close or support can investigate.
- **Description:** Confirm dùng `allowedActions.confirmDelivery`; dispute mở modal với mô tả + tối đa 5 ảnh.
- **Preconditions:** GHN đã báo giao (confirm) hoặc đơn đang giao (dispute).
- **Postconditions:** COMPLETED hoặc DELIVERY_DISPUTED.
- **Priority:** P0
- **Source:** Inferred from `OrderDetailScreen.tsx`, `DeliveryDisputeModal.tsx`, BE BR-029/BR-030
- **Confidence:** High
- **Related AC:** AC-048, AC-049, AC-050

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-048 | `confirmDelivery=true` | Bấm “Tôi đã nhận hàng” | Gọi API confirm; thành công thì refetch và báo đã nhận | Unverified |
| AC-049 | `reportDeliveryIssue=true`, chưa có dispute OPEN | Mở modal | Chỉ cho gửi khi mô tả ≥10 ký tự, ≤2000; tối đa 5 ảnh | Unverified |
| AC-050 | Gửi dispute thành công | Tranh chấp OPEN | Order DELIVERY_DISPUTED; chi tiết hiện mô tả/ảnh, ẩn nút mở tranh chấp mới | Unverified |

## US-016 — Báo lỗi/đổi trả và hoàn tiền

- **Actor:** Customer
- **Story:** As a customer, I want to report an item issue with evidence and bank details, so that I can return it and receive a refund.
- **Description:** ReportIssueModal hai mode PRODUCT/REFUND_NOT_RECEIVED; chặn theo 7 ngày, trạng thái đơn và issue đang mở.
- **Preconditions:** Order COMPLETED hoặc đang trong luồng trả; item chưa có issue chặn.
- **Postconditions:** Issue PENDING; order RETURN_REQUESTED.
- **Priority:** P0
- **Source:** Inferred from `ReportIssueModal.tsx`, `order-returns.ts`, BE BR-031…BR-033
- **Confidence:** High
- **Related AC:** AC-051, AC-052, AC-053, AC-054

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-051 | Order COMPLETED trong 7 ngày | Mở chi tiết | Nút báo lỗi hiện cho item chưa bị chặn | Unverified |
| AC-052 | Order CREATED/PAID/SHIPPING | Mở chi tiết | Không có nút báo lỗi | Unverified |
| AC-053 | Form thiếu mô tả/ảnh/STK | Bấm gửi | Chặn gửi với thông báo tương ứng từng trường | Unverified |
| AC-054 | Ảnh >10MB hoặc sai định dạng | Chọn ảnh | Ảnh bị loại, có thông báo; ảnh hợp lệ được nén JPEG ≤1600px | Unverified |

## US-017 — Đóng hỗ trợ hoàn tiền

- **Actor:** Customer
- **Story:** As a customer, I want to confirm I received the refund or report that I did not, so that support closes only when money actually arrived.
- **Description:** Khi `refundStatus=COMPLETED`, hiện xác nhận hoặc báo chưa nhận; báo chưa nhận dùng issue REFUND_NOT_RECEIVED.
- **Preconditions:** Có refund COMPLETED.
- **Postconditions:** `refundConfirmedAt` set hoặc issue REFUND_NOT_RECEIVED.
- **Priority:** P0
- **Source:** Inferred from `OrderDetailScreen.tsx`, `OrderReturnsScreen.tsx`, `order-returns.ts`, BE BR-037
- **Confidence:** High
- **Related AC:** AC-055, AC-056, AC-057

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-055 | `refundStatus=COMPLETED`, chưa xác nhận | Bấm “Đã nhận được tiền” | Gọi `POST /orders/:id/refund/confirm-received`; hiện đã xác nhận | Unverified |
| AC-056 | Refund COMPLETED trong 7 ngày, chưa có issue mở | Bấm “Chưa nhận được tiền hoàn” | Mở form mode REFUND_NOT_RECEIVED với STK mặc định | Unverified |
| AC-057 | Quá 7 ngày hoặc không có refund COMPLETED | Mở OrderReturns | Không hiện nút báo chưa nhận tiền | Unverified |

## US-018 — Điều hướng từ thông báo

- **Actor:** Customer
- **Story:** As a customer, I want a notification tap to open the right order or return screen, so that I do not search manually.
- **Description:** Push/socket map notification type sang route.
- **Preconditions:** Có notification có `orderId`/`orderCode`.
- **Postconditions:** Đúng màn đích; notification không hợp lệ bị bỏ qua.
- **Priority:** P2
- **Source:** Inferred from `order-notification-target.ts`, `use-push-notifications.ts`
- **Confidence:** High
- **Related AC:** AC-058, AC-059, AC-060

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-058 | Notification issue review/refund | Bấm | Mở `OrderReturns` với `orderId` | Unverified |
| AC-059 | Notification issue không có order | Bấm | Mở danh sách `Returns` | Unverified |
| AC-060 | Notification order status/chat | Bấm | Mở `OrderDetail` (chat thì focus chat) | Unverified |
