# Screens, components, APIs — FLW-002 (mobile)

Route names theo `RootStackParamList`/`ProfileStack`. Mobile dùng chung endpoint BE với web; API ID tham chiếu bộ `checkout-to-delivery` (FLW-001), không tạo ID trùng nghĩa.

## SCR-017 — Giỏ hàng

- **Route / Module / Purpose:** `Cart` (modal root stack) · `src/features/cart/screens/CartScreen.tsx` · xem/sửa giỏ trước checkout.
- **Roles:** Customer đã đăng nhập (route chỉ tồn tại trong nhánh authenticated, `root-navigator.tsx:61-69`).
- **Entry conditions:** Bấm icon giỏ từ tab; có ít nhất 0 dòng.
- **Related:** US-011 / AC-037 / BR-044, BR-051

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-041 | `CartScreen` + `CartLineRow` | Hiển thị dòng, tăng/giảm/xoá, chọn màu | BR-044 |
| CMP-042 | `CartSummary` / nút thanh toán | Tổng hiển thị, mở Checkout | BR-044, BR-051 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-001 | GET | `/cart` | Tải giỏ server |
| API-002 | POST | `/cart/items` | Thêm dòng |
| API-003 | PATCH | `/cart/items/:id` | Đổi số lượng |
| API-004 | DELETE | `/cart/items/:id` | Xoá dòng |
| API-005 | DELETE | `/cart` | Xoá giỏ |

**States:** loading (skeleton), empty (“Giỏ hàng trống”), error + thử lại, success. Không có trạng thái permission denied trong app (route đã auth).
**Interactions:** `openCheckout` → `navigation.navigate('Checkout')` (`CartScreen.tsx:openCheckout:29`). Stepper không chặn trần 1000 phía client (BUG-029).

## SCR-018 — Checkout

- **Route / Module / Purpose:** `Checkout` · `src/features/checkout/screens/CheckoutScreen.tsx` · địa chỉ, ghi chú, coupon, quote, cổng số đo, tạo đơn.
- **Roles:** Customer.
- **Entry conditions:** Từ Cart; giỏ có món.
- **Related:** US-011 / AC-037…AC-039 / BR-044…BR-053, BR-081

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-042 | `AddressSection` + `AddressPicker`/`AddressForm` | Chọn địa chỉ đã lưu hoặc nhập mới | BR-046 |
| CMP-043 | `QuoteSummary` + coupon field | Hiển thị tạm tính/sale/ship/tổng; áp coupon | BR-044, BR-045, BR-049, BR-050, BR-081 |
| CMP-044 | `MeasurementsGate` | Chặn khi thiếu số đo | BR-047 |
| CMP-045 | `UnpaidOrdersNotice` | Nhắc đơn chưa thanh toán | BR-051 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-050 | GET | `/users/me/addresses` | Sổ địa chỉ |
| API-051 | POST | `/users/me/addresses` | Thêm địa chỉ |
| API-036 | GET | `/shipping/address-catalog/provinces` | Tỉnh/thành |
| API-037 | GET | `/shipping/address-catalog/wards` | Phường/xã |
| API-038 | GET | `/shipping/capabilities` | Revision catalog |
| API-052 | GET | `/users/me/measurements/completeness` | Cổng số đo |
| API-008 | POST | `/orders/quote` | Báo giá + quote token |
| API-009 | GET | `/orders?limit=5` | Đơn chưa thanh toán |
| API-007 | POST | `/orders` | Tạo đơn |
| API-025 | POST | `/payments/checkout` | Tạo link thanh toán |

**States:** initial (đang tải giỏ/địa chỉ), quoting, quote error + retry, thiếu địa chỉ, thiếu số đo, submitting (disable nút), success → Payment, error Alert.
**Interactions:** quote tự chạy lại khi items/địa chỉ/ghi chú/coupon đổi; `handlePlaceOrder` → tạo đơn → tạo payment → `navigate('Payment')` (`CheckoutScreen.tsx:545-660`).

## SCR-019 — Payment

- **Route / Module / Purpose:** `Payment` (modal) · `src/features/checkout/screens/PaymentScreen.tsx` · mở cổng, QR, poll, result.
- **Roles:** Customer.
- **Entry conditions:** Có `checkoutUrl`/`payUrl`, `paymentId` (tùy provider), `orderId`.
- **Related:** US-012 / AC-040…AC-042 / BR-054…BR-063, BR-080

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-045 | `WebView` SePay + `QrPanel` | Hiển thị cổng/QR | BR-055, BR-057 |
| CMP-046 | `ResultSheet` | PAID/cancel/failed/expired/refund-required | BR-056, BR-058, BR-059 |
| CMP-052 | `OrderSuccessScreen` (đích) | Xác nhận lại bằng đơn | BR-061, BR-062, BR-063 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-025 | POST | `/payments/checkout` | Đã gọi từ Checkout/OrderDetail; Payment chỉ nhận params |
| API-029 | GET | `/payments/:paymentId` | Poll trạng thái thanh toán |

**States:** ZaloPay QR/chờ; SePay QR + WebView; PAID → replace OrderSuccess; FAILED/EXPIRED/huỷ/REFUND_REQUIRED → ResultSheet; thiếu URL → lỗi.
**Interactions:** poll 3s (`PAYMENT_POLL_INTERVAL_MS:34`); WebView `onNavigationStateChange` dò URL (`:380`); “Hủy thanh toán” chỉ local (`:365`).

## SCR-020 — Danh sách đơn

- **Route / Module / Purpose:** Profile tab `Orders` · `src/features/orders/screens/OrdersScreen.tsx` · lọc/tìm đơn.
- **Roles:** Customer.
- **Entry conditions:** Tab Hồ sơ → Đơn hàng.
- **Related:** US-013, US-014 / AC-043, AC-046 / BR-064

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-047 | `FILTER_TABS` + `OrderCard` | Tab trạng thái, tìm kiếm, card + action | BR-064 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-009 | GET | `/orders` | Danh sách phân trang (limit 20) |
| API-012 | PATCH | `/orders/:id/cancel` | Hủy từ card (nếu được phép) |

**States:** loading, empty theo tab, error + retry, pagination loading.
**Interactions:** tab gửi `status` (`OrdersScreen.tsx:43-54`); mở `OrderDetail`; cancel modal.

## SCR-021 — Chi tiết đơn

- **Route / Module / Purpose:** `OrderDetail` · `src/features/orders/screens/OrderDetailScreen.tsx` · tiến trình, tracking, thanh toán lại, hủy, xác nhận nhận, tranh chấp, tóm tắt đổi trả.
- **Roles:** Customer sở hữu đơn.
- **Entry conditions:** Từ danh sách, notification, OrderSuccess.
- **Related:** US-013…US-017 / AC-044…AC-050, AC-055 / BR-065…BR-069, BR-075

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-048 | `OrderStatusTimeline` + action bar | Trạng thái, hủy, xác nhận, dispute, payment lại | BR-065, BR-066, BR-068, BR-069 |
| CMP-050 | `RefundNotice` | Xác nhận đã nhận tiền hoàn | BR-075 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-010 | GET | `/orders/:id` | Chi tiết + `allowedActions` + tracking |
| API-011 | GET | `/orders/:id/tracking` | Tracking (mobile hiện không dùng) |
| API-012 | PATCH | `/orders/:id/cancel` | Hủy |
| API-016 | POST | `/orders/:id/delivery-dispute` | Báo chưa nhận |
| API-023 | POST | `/orders/:id/confirm-delivery` | Xác nhận đã nhận |
| API-022 | POST | `/orders/:id/refund/confirm-received` | Xác nhận nhận tiền hoàn |
| API-025 | POST | `/payments/checkout` | Thanh toán lại |

**States:** loading, error + retry, pending payment, shipping, dispute open, completed, cancelled; refetch 30s.
**Interactions:** nút chỉ hiện theo `allowedActions` (`:541-542`); dispute modal; link sang OrderReturns.

## SCR-022 — Đổi trả / hoàn tiền của một đơn

- **Route / Module / Purpose:** `OrderReturns` · `src/features/orders/screens/OrderReturnsScreen.tsx` · issue list, refund lines, timeline, báo lỗi/đổi trả, báo chưa nhận tiền.
- **Roles:** Customer sở hữu đơn.
- **Entry conditions:** Từ OrderDetail, notification, MyReturns.
- **Related:** US-016, US-017 / AC-051…AC-057 / BR-070…BR-077

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-049 | `ReportIssueModal` | Form issue/refund-not-received | BR-070…BR-074 |
| CMP-050 | `OrderIssuesList`, `OrderRefundLines`, `ReturnHistoryTimeline` | Trạng thái và chứng từ | BR-076 |
| CMP-044 | `EvidencePicker` (utils) | Chọn/nén ảnh | BR-073 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-010 | GET | `/orders/:id` | Nguồn issue/refund/order |
| API-044 | GET | `/orders/:orderId/issues` | Danh sách issue |
| API-043 | POST | `/orders/:orderId/items/:itemId/issues` | Tạo issue (multipart) |
| API-022 | POST | `/orders/:id/refund/confirm-received` | Chỉ từ OrderDetail |

**States:** loading, empty (“chưa có yêu cầu đổi trả”), return-flow notice, error, form validation, submitting.
**Interactions:** chọn item → modal PRODUCT; refund completed → modal REFUND_NOT_RECEIVED; `goToOrder`/`goToAllReturns`.

## SCR-023 — Danh sách đổi trả

- **Route / Module / Purpose:** Profile tab `Returns` · `src/features/orders/screens/MyReturnsScreen.tsx`.
- **Roles:** Customer.
- **Entry conditions:** Tab Hồ sơ → Đổi trả; notification không có order.
- **Related:** US-017 / AC-057 / BR-077

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-051 | `ReturnRow` | Đơn + trạng thái đại diện | BR-077 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-046 | GET | `/order-issues/mine` | Đơn có đổi trả, phân trang 10 |

**States:** loading, empty, error, infinite scroll.

## SCR-024 — Order success

- **Route / Module / Purpose:** `OrderSuccess` · `src/features/orders/screens/OrderSuccessScreen.tsx` · xác nhận thanh toán sau khi rời cổng.
- **Roles:** Customer.
- **Entry conditions:** PaymentScreen nhận PAID.
- **Related:** US-012 / AC-042 / BR-061…BR-063

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-052 | `PaymentStatusCard` + poller | Poll đơn 2s/20s, hiển thị kết quả | BR-061, BR-062, BR-063 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-010 | GET | `/orders/:id` | Trạng thái thanh toán/đơn |

**States:** loading, confirming, paid, timeout/failure.

## SCR-025 — Notifications

- **Route / Module / Purpose:** `Notifications` · `src/features/notifications/screens/NotificationsScreen.tsx` + push/socket handlers.
- **Roles:** Customer.
- **Related:** US-018 / AC-058…AC-060 / BR-079

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-051 | `resolveOrderNotificationTarget` + handlers | Map loại → route | BR-079 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-053 | GET | `/notifications` | Danh sách thông báo |
| API-054 | PATCH | `/notifications/:id/read` | Đánh dấu đã đọc |
| API-055 | POST | `/device-tokens` | Đăng ký push token |

**States:** loading, empty, error; notification không map được → bỏ qua.

## Liên kết ngược

- Mọi SCR đều thuộc US-011…US-018; không có màn orphan.
- `API-011` (tracking) và `API-053…055` nằm ngoài luồng chính nhưng có owner (SCR-021/SCR-025); `API-011` hiện không được gọi → BUG-031.
- `paymentsApi.getPaymentOrders` (`/payments/orders`) không có caller → dead client, ghi ở 09-audit.
