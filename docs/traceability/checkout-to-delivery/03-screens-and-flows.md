# Screens, Components & API Traceability — FLW-001

Route FE đều nằm trong `FashionAI_FE/`; API có prefix `/api` (`BE src/main.ts:17`).
Mọi SCR phải có chủ sở hữu US/BR; mọi BR đã được phân loại ở `02-business-rules.md`
(screen-bound, API-bound hoặc background job).

---

### SCR-001 — Giỏ hàng

- Route / Module / Purpose: `/cart` → `FE src/features/cart/components/cart-page.tsx:CartPage:39`; xem/sửa giỏ, vào checkout.
- Roles: Guest + Customer (route public).
- Entry conditions: không.
- Related US / BR: US-001 / BR-001, BR-043

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-001 | `CartPage` | Danh sách dòng, tổng tiền, CTA đặt hàng, xoá giỏ | BR-043 |
| CMP-002 | `CartLine` | Ảnh, giá gạch, stepper, trạng thái ngừng bán | BR-043, BR-001 |
| CMP-003 | `CartSync` | Merge giỏ guest khi đăng nhập, cảnh báo rời trang | BR-043 |
| CMP-004 | `CartSlideOver` | Giỏ nhanh toàn app | BR-043 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-001 | GET | `/cart` | Lấy giỏ server |
| API-002 | POST | `/cart/items` | Thêm dòng |
| API-003 | PATCH | `/cart/items/:id` | Đổi số lượng |
| API-004 | DELETE | `/cart/items/:id` | Xoá dòng |
| API-005 | DELETE | `/cart` | Xoá toàn bộ |
| API-006 | POST | `/cart/merge` | Merge giỏ guest |

States: loading (`AtelierLoader`), error + retry, empty, có món; **không** có trạng thái
permission-denied (public). Không có stock số lượng, không chọn từng dòng.

Interactions: “Tiến hành đặt hàng” → `/checkout`; đổi số lượng → optimistic + mutation
serialize; món unavailable không tính vào tổng.

---

### SCR-002 — Checkout

- Route / Module / Purpose: `/checkout` → `FE src/features/checkout/components/checkout-page.tsx:CheckoutPage:48`; chọn địa chỉ, xem phí GHN, coupon, phương thức thanh toán, đặt đơn.
- Roles: Customer (middleware yêu cầu `auth_marker`, ngược lại 302 `/login?callbackUrl=`).
- Entry conditions: có món khả dụng; hồ sơ số đo (FE cảnh báo, BE chặn).
- Related US / BR: US-002, US-003 / BR-003…BR-011, BR-016

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-005 | `CheckoutPage` | Điều phối quote, submit, khoá item sau khi bấm | BR-004, BR-005, BR-011 |
| CMP-006 | `CheckoutSummary` | Tổng tiền, coupon, nút đặt hàng | BR-005, BR-006 |
| CMP-007 | `AddressForm` | Thêm địa chỉ GHN 2 cấp | BR-009 |
| CMP-008 | `DeliveryOptions` | Chọn ZaloPay / SePay | BR-010, BR-016 |
| CMP-009 | `PaymentMethodSelector` (thực chất là ô coupon) | Áp/bỏ mã | BR-006 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-008 | POST | `/orders/quote` | Báo giá + `quoteToken` |
| API-007 | POST | `/orders` | Tạo đơn |
| API-025 | POST | `/payments/checkout` | Tạo link thanh toán |
| API-050 | GET | `/users/me/addresses` | Sổ địa chỉ |
| API-051 | POST | `/users/me/addresses` | Thêm địa chỉ |
| API-036 | GET | `/shipping/address-catalog/provinces` | Tỉnh/Thành post-merger |
| API-037 | GET | `/shipping/address-catalog/wards` | Phường/Xã |
| API-038 | GET | `/shipping/capabilities` | Revision catalog |
| API-052 | GET | `/users/me/measurements/completeness` | Cổng số đo |

States: cart loading/error/empty; address loading; thiếu địa chỉ; quote loading
(“Đang tính phí giao hàng”); pricing error; coupon error; submit blocked.
Thiếu: lỗi tải sổ địa chỉ bị hiển thị như “chưa có địa chỉ” (BUG-009); lỗi completeness bị bỏ qua.

Interactions: đổi địa chỉ/món → re-quote; ghi chú debounce 600ms; quote cache dùng lại nếu
còn >60s; đóng dialog ZaloPay giữ đơn chờ thanh toán; SePay mở form POST sang cổng.

---

### SCR-003 — Dialog thanh toán

- Route / Module / Purpose: modal trong `/checkout` và `/orders/[id]` → `FE src/features/payments/components/payment-dialog.tsx`.
- Roles: Customer.
- Entry conditions: có `CheckoutResponse.checkoutUrl`.
- Related US / BR: US-003 / BR-016, BR-017, BR-019

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-010 | `ZaloPayPaymentDialog` | QR + poll 2s tới khi settled | BR-017, BR-020 |
| CMP-011 | `BankTransferPaymentDialog` | Nội dung CK `FAI{orderCode}`, mở cổng SePay | BR-018 |
| CMP-012 | `payment-gateway` service | Form POST/redirect tới cổng | BR-018 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-025 | POST | `/payments/checkout` | Lấy `checkoutUrl`/`qrCode` |
| API-029 | GET | `/payments/:paymentId` | Poll trạng thái (kèm query cổng khi PENDING) |

States: chờ quét, PAID → điều hướng `/payment/result`, FAILED hiển thị lý do,
REFUND_REQUIRED hiển thị thông báo hoàn tiền.
Gap: SePay dialog không poll; người dùng phải quay lại trang đơn.

---

### SCR-004 — Kết quả thanh toán

- Route / Module / Purpose: `/payment/result` → `FE src/features/payments/components/payment-result-page.tsx:159`.
- Roles: Customer.
- Entry conditions: có `?paymentId=`.
- Related US / BR: US-003 / BR-019, BR-021

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-013 | `PaymentResultContent` | Phân nhánh PAID/settled/FAILED/REFUND_REQUIRED/pending | BR-021, BR-036 |
| CMP-014 | `PaymentStatusCard` | Hiển thị trạng thái + CTA | – |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-029 | GET | `/payments/:paymentId` | Trạng thái thanh toán (tự poll 2s) |

States: loading, không tìm thấy, cần đăng nhập, PAID, settled-khác, FAILED,
REFUND_REQUIRED, pending. Không có nút “thử lại” riêng — CTA dẫn về đơn.

---

### SCR-005 — Trang trả về từ cổng (legacy / SePay)

- Route / Module / Purpose: `/payment/success` (`payment-success-page.tsx:237`), `/payment/cancel`, `/payment/error`.
- Roles: Customer.
- Entry conditions: cổng redirect kèm `orderCode|orderId|status|kind`.
- Related US / BR: US-003 / BR-018, BR-021

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-015 | `PaymentSuccessContent` | Resolve đơn theo `orderId`/`orderCode`, poll 2s ≤20s | BR-021 |
| CMP-016 | `PaymentOutcomeContent` | Card tĩnh cho cancel/error | – |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-009 | GET | `/orders?search=&limit=5` | Tìm đơn theo mã |
| API-010 | GET | `/orders/:id` | Poll trạng thái đơn |

States: paid, awaiting-confirmation, cancel, failed, not-found (neutral).
Gap: `/payment/cancel|error` không truy vấn đơn nên không phân biệt pending vs expired.

---

### SCR-006 — Danh sách đơn của khách

- Route / Module / Purpose: `/profile/orders` → `FE src/features/orders/components/profile-orders-page.tsx:OrdersPage:319`.
- Roles: Customer.
- Related US / BR: US-004, US-005 / BR-014

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-017 | `OrdersPage` | Tab lọc trạng thái, tìm kiếm, infinite scroll | BR-014 |
| CMP-018 | `OrderStatusLabel` | Nhãn tiếng Việt theo `STATUS_CONFIG` | – |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-009 | GET | `/orders` | Danh sách phân trang + `status/search` |

States: loading, empty, error; tab theo trạng thái; nút “Đánh giá” chỉ khi COMPLETED.

---

### SCR-007 — Chi tiết đơn (khách)

- Route / Module / Purpose: `/orders/[id]` → `FE src/features/orders/components/orders-id-page.tsx:OrderDetailPage:129`.
- Roles: Customer (chủ đơn; BE trả 404 nếu không sở hữu).
- Entry conditions: có `id`.
- Related US / BR: US-002…US-007 / BR-014, BR-024, BR-029…BR-032

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-019 | `OrderDetailPage` | Tổng hợp trạng thái, item, thanh toán, giao hàng, timeline | BR-014, BR-029 |
| CMP-020 | `OrderPaymentAction` | Mở lại thanh toán khi CREATED+PENDING | BR-016 |
| CMP-021 | `OrderMeasurementReview` | Khách bổ sung số đo theo yêu cầu | BR-024 |
| CMP-022 | `ReportIssueModal` | Tạo issue (ảnh, STK, mô tả) | BR-031, BR-032 |
| CMP-023 | `DeliveryDisputeModal` | Báo chưa nhận hàng | BR-030 |
| CMP-024 | `ConfirmDeliveryDialog` | Xác nhận đã nhận | BR-029 |
| CMP-025 | `OrderHistoryTimeline` | 5 event gần nhất + mở rộng | – |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-010 | GET | `/orders/:id` | Chi tiết (poll 30s khi chưa kết thúc) |
| API-011 | GET | `/orders/:id/tracking` | Tracking GHN |
| API-012 | PATCH | `/orders/:id/cancel` | Hủy đơn |
| API-013 | PATCH | `/orders/:orderId/items/:itemId/measurement` | Gửi lại số đo |
| API-043 | POST | `/orders/:orderId/items/:orderItemId/issues` | Tạo issue |
| API-044 | GET | `/orders/:orderId/issues` | Danh sách issue của đơn |
| API-016 | POST | `/orders/:id/delivery-dispute` | Báo chưa nhận |
| API-023 | POST | `/orders/:id/confirm-delivery` | Xác nhận nhận |
| API-022 | POST | `/orders/:id/refund/confirm-received` | Xác nhận đã nhận tiền hoàn |

States: loading, not-found/forbidden, awaiting payment, dispute open, refund completed,
return flow, terminal. `canReportIssue` do FE tính từ event COMPLETED + 7 ngày, BE kiểm tra lại.

---

### SCR-008 — Đổi trả & hoàn tiền (khách)

- Route / Module / Purpose: `/orders/[id]/returns` (`order-returns-page.tsx:36`), `/profile/returns` (`profile-returns-page.tsx:77`).
- Roles: Customer.
- Related US / BR: US-006, US-007 / BR-031…BR-038

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-026 | `OrderReturnsPage` | Trạng thái luồng trả, issue list, refunds, timeline | BR-031, BR-038 |
| CMP-027 | `OrderIssuesList` / `IssueCard` | Trạng thái issue, ảnh, phản hồi shop | BR-038 |
| CMP-028 | `OrderRefundLines` | Từng khoản GOODS/SHIPPING + chứng từ | BR-033, BR-034 |
| CMP-029 | `ProfileReturnsPage` | Danh sách đổi trả theo đơn | BR-031 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-046 | GET | `/order-issues/mine` | Các đơn có issue |
| API-044 | GET | `/orders/:orderId/issues` | Issue của một đơn |
| API-047 | GET | `/order-issues/:issueId` | Chi tiết issue |
| API-043 | POST | `/orders/:orderId/items/:orderItemId/issues` | Báo chưa nhận tiền hoàn (mode riêng) |

States: empty (copy nêu cửa sổ 7 ngày), luồng trả theo `RETURN_FLOW_TITLES`, RETURNED
(hoàn tất vs đang xử lý), danh sách issue/refund. Không có trạng thái “đổi hàng”.

---

### SCR-009 — Admin: danh sách đơn

- Route / Module / Purpose: `/admin/dashboard?tab=orders` → `FE src/features/admin/components/admin-orders-panel.tsx:AdminOrdersPanel:12`.
- Roles: Admin (`AdminGuard`).
- Related US / BR: US-008 / BR-014, BR-042

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-030 | `AdminOrdersPanel` | Lọc/tìm đơn, badge cần xử lý/cần hoàn tiền | BR-014, BR-042 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-024 | GET | `/orders/all` | Danh sách toàn bộ đơn (admin) |

States: loading, empty, error; filter client-side lại sau khi server trả (comment: BE có lúc bỏ qua filter).
Không có bulk action.

---

### SCR-010 — Admin: chi tiết đơn

- Route / Module / Purpose: `/admin/orders/[id]` (`admin-order-measurements-page.tsx:81`).
- Roles: Admin.
- Related US / BR: US-004, US-008, US-009 / BR-014, BR-015, BR-024, BR-025, BR-035…BR-038

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-031 | `AdminOrderMeasurementsPage` | Dossier đơn + đổi trạng thái + tạo vận đơn | BR-014, BR-025 |
| CMP-032 | `AdminRefundPanel` | 4 bước hoàn tiền, form GOODS/SHIPPING | BR-033…BR-036 |
| CMP-033 | `AdminRefundHistory` | Chốt refund cổng đang PROCESSING | BR-039 |
| CMP-034 | `AdminOrderIssueModal` | Duyệt/từ chối issue, “hoàn ngay” | BR-038 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-010 | GET | `/orders/:id` | Chi tiết (admin xem mọi đơn) |
| API-018 | PATCH | `/orders/:id/status` | Đổi trạng thái |
| API-019 | POST | `/orders/:id/shipment` | Tạo vận đơn |
| API-020 | POST | `/orders/:id/shipment/cancel` | Hủy vận đơn theo đơn |
| API-021 | PATCH | `/orders/:id/refund` | Chốt/không hoàn khoản |
| API-030 | POST | `/payments/admin/orders/:orderCode/confirm-manual` | Xác nhận thanh toán tay |
| API-048 | PATCH | `/order-issues/:issueId/review` | Duyệt/từ chối issue |
| API-034 | POST | `/payments/admin/refunds/:refundId/finalize` | Chốt refund cổng |
| API-033 | POST | `/payments/admin/:paymentId/refunds` | Hoàn tiền qua cổng (MoMo/ZaloPay) |
| API-014 | POST | `/orders/:orderId/items/:itemId/measurement-review` | Mở yêu cầu số đo |
| API-015 | PATCH | `/orders/:orderId/items/:itemId/measurement-review` | Sửa/mở lại yêu cầu |
| API-017 | PATCH | `/orders/:id/delivery-dispute` | Xử lý tranh chấp |

States: terminal status khoá dropdown; banner thanh toán tay khi PENDING; nút tạo vận đơn
kèm tooltip lý do khoá; refund panel chặn chốt khi chưa RETURNED (trừ “hoàn ngay”).
Admin **không** chọn được SHIPPING/DELIVERED (chỉ webhook/simulator).

---

### SCR-011 — Admin: vận đơn

- Route / Module / Purpose: `/admin/dashboard?tab=shipments`, `/admin/shipments/[id]`.
- Roles: Admin.
- Related US / BR: US-008 / BR-025…BR-028

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-035 | `AdminShipmentsPanel` | Danh sách, lọc sự cố/chưa sync, hủy, giả lập | BR-026, BR-027 |
| CMP-036 | `AdminShipmentDetailPage` | Timeline, phí quote/thực, webhook audit | BR-027, BR-028 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-039 | GET | `/admin/shipments` | Danh sách vận đơn |
| API-040 | GET | `/admin/shipments/:id` | Chi tiết + webhook + event |
| API-041 | POST | `/admin/shipments/:id/cancel` | Hủy vận đơn |
| API-049 | POST | `/internal/staging/shipments/:shipmentId/status` | Giả lập trạng thái (staging) |

States: loading, empty, error; `canCancel` theo trạng thái; không có in nhãn GHN,
không hiển thị `trackingUrl` dù type có.

---

### SCR-012 — Admin: đối soát

- Route / Module / Purpose: `/admin/reconciliation`; tab `reconciliation`/`webhook-failures`.
- Roles: Admin.
- Related US / BR: US-010 / BR-040, BR-041

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-037 | `AdminReconciliationPanel` | Tab chưa/đã xử lý, auto-refresh 30s | BR-041 |
| CMP-038 | `AdminConfirmPaymentModal` | Gán giao dịch vào đơn + note | BR-040 |
| CMP-039 | `AdminIgnoreFailureModal` | Đánh dấu đã xử lý | BR-041 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-035 | GET | `/payments/admin/unmatched-transactions` | Giao dịch lạ + gợi ý |
| API-031 | GET | `/payments/admin/webhook-failures` | Webhook lỗi |
| API-032 | PATCH | `/payments/admin/webhook-failures/:id/resolve` | Bỏ qua |
| API-030 | POST | `/payments/admin/orders/:orderCode/confirm-manual` | Gán + xác nhận |

States: unresolved/resolved, không có ứng viên, lỗi tải; “Bỏ qua” chỉ resolve failure.

---

### SCR-013 — Admin: hàng đợi đổi trả

- Route / Module / Purpose: `/admin/dashboard?tab=order-issues`.
- Roles: Admin.
- Related US / BR: US-009 / BR-031…BR-038

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-040 | `AdminOrderIssuesPanel` | Lọc status/reason, mở modal xử lý | BR-038 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-045 | GET | `/order-issues` | Danh sách issue (admin) |
| API-047 | GET | `/order-issues/:issueId` | Chi tiết |
| API-048 | PATCH | `/order-issues/:issueId/review` | Duyệt/từ chối |

States: badge theo status; modal 2 chế độ duyệt; checkbox hoàn ship auto theo lý do lỗi shop.

---

## API inventory

| API | Method | Endpoint | Auth | Purpose | BR |
|---|---|---|---|---|---|
| API-001 | GET | `/cart` | JWT | Giỏ server | BR-043 |
| API-002 | POST | `/cart/items` | JWT | Thêm dòng | BR-043 |
| API-003 | PATCH | `/cart/items/:id` | JWT | Sửa số lượng | BR-043 |
| API-004 | DELETE | `/cart/items/:id` | JWT | Xoá dòng | BR-043 |
| API-005 | DELETE | `/cart` | JWT | Xoá giỏ | BR-043 |
| API-006 | POST | `/cart/merge` | JWT | Merge giỏ guest | BR-043 |
| API-007 | POST | `/orders` | JWT | Tạo đơn | BR-001…BR-013 |
| API-008 | POST | `/orders/quote` | JWT | Báo giá | BR-001, BR-004, BR-005, BR-008 |
| API-009 | GET | `/orders` | JWT | Đơn của tôi | BR-014 |
| API-010 | GET | `/orders/:id` | JWT (owner/admin) | Chi tiết đơn | BR-014 |
| API-011 | GET | `/orders/:id/tracking` | JWT (owner) | Tracking GHN | BR-028 |
| API-012 | PATCH | `/orders/:id/cancel` | JWT (owner) | Hủy đơn | BR-013 |
| API-013 | PATCH | `/orders/:orderId/items/:itemId/measurement` | JWT (owner) | Gửi lại số đo | BR-024 |
| API-014 | POST | `/orders/:orderId/items/:itemId/measurement-review` | ADMIN | Mở yêu cầu số đo | BR-024, BR-042 |
| API-015 | PATCH | `/orders/:orderId/items/:itemId/measurement-review` | ADMIN | Sửa/mở lại yêu cầu | BR-024, BR-042 |
| API-016 | POST | `/orders/:id/delivery-dispute` | JWT (owner) | Báo chưa nhận | BR-030 |
| API-017 | PATCH | `/orders/:id/delivery-dispute` | ADMIN | Xử lý tranh chấp | BR-030, BR-042 |
| API-018 | PATCH | `/orders/:id/status` | ADMIN | Đổi trạng thái | BR-014, BR-015, BR-042 |
| API-019 | POST | `/orders/:id/shipment` | ADMIN | Tạo vận đơn | BR-025 |
| API-020 | POST | `/orders/:id/shipment/cancel` | ADMIN | Hủy vận đơn theo đơn | BR-026 |
| API-021 | PATCH | `/orders/:id/refund` | ADMIN | Chốt hoàn tiền tay | BR-035, BR-036 |
| API-022 | POST | `/orders/:id/refund/confirm-received` | JWT (owner) | Xác nhận đã nhận tiền | BR-037 |
| API-023 | POST | `/orders/:id/confirm-delivery` | JWT (owner) | Xác nhận nhận hàng | BR-029 |
| API-024 | GET | `/orders/all` | ADMIN | Danh sách đơn | BR-042 |
| API-025 | POST | `/payments/checkout` | JWT | Tạo link thanh toán | BR-016, BR-017, BR-018 |
| API-026 | POST | `/payments/zalopay/callback` | Public | Callback ZaloPay | BR-017 |
| API-027 | POST | `/payments/sepay-ipn` | Public | IPN SePay | BR-018 |
| API-028 | POST | `/payments/sepay-webhook` | Public | Webhook chuyển khoản | BR-018 |
| API-029 | GET | `/payments/:paymentId` | JWT (owner) | Trạng thái thanh toán | BR-019 |
| API-030 | POST | `/payments/admin/orders/:orderCode/confirm-manual` | ADMIN | Xác nhận tay | BR-040 |
| API-031 | GET | `/payments/admin/webhook-failures` | ADMIN | Webhook lỗi | BR-041 |
| API-032 | PATCH | `/payments/admin/webhook-failures/:id/resolve` | ADMIN | Đánh dấu xử lý | BR-041 |
| API-033 | POST | `/payments/admin/:paymentId/refunds` | ADMIN | Hoàn tiền qua cổng | BR-039 |
| API-034 | POST | `/payments/admin/refunds/:refundId/finalize` | ADMIN | Chốt refund cổng | BR-039 |
| API-035 | GET | `/payments/admin/unmatched-transactions` | ADMIN | Giao dịch chưa khớp | BR-040 |
| API-036 | GET | `/shipping/address-catalog/provinces` | Public | Tỉnh/Thành | BR-009 |
| API-037 | GET | `/shipping/address-catalog/wards` | Public | Phường/Xã | BR-009 |
| API-038 | GET | `/shipping/capabilities` | Public | Revision catalog | BR-009 |
| API-039 | GET | `/admin/shipments` | ADMIN | Danh sách vận đơn | BR-042 |
| API-040 | GET | `/admin/shipments/:id` | ADMIN | Chi tiết vận đơn | BR-042 |
| API-041 | POST | `/admin/shipments/:id/cancel` | ADMIN | Hủy vận đơn | BR-026 |
| API-042 | POST | `/webhooks/shipping/ghn` | Public + secret | GHN webhook | BR-027 |
| API-043 | POST | `/orders/:orderId/items/:orderItemId/issues` | JWT (owner) | Tạo issue | BR-031, BR-032 |
| API-044 | GET | `/orders/:orderId/issues` | JWT (owner/admin) | Issue theo đơn | BR-031 |
| API-045 | GET | `/order-issues` | ADMIN | Danh sách issue | BR-042 |
| API-046 | GET | `/order-issues/mine` | JWT | Đơn có issue của tôi | BR-042 |
| API-047 | GET | `/order-issues/:issueId` | JWT (owner/admin) | Chi tiết issue | BR-042 |
| API-048 | PATCH | `/order-issues/:issueId/review` | ADMIN | Duyệt/từ chối | BR-032, BR-038 |
| API-049 | POST | `/internal/staging/shipments/:shipmentId/status` | ADMIN | Giả lập GHN | BR-027 |
| API-050 | GET | `/users/me/addresses` | JWT | Sổ địa chỉ | BR-009 |
| API-051 | POST | `/users/me/addresses` | JWT | Thêm địa chỉ | BR-009 |
| API-052 | GET | `/users/me/measurements/completeness` | JWT | Cổng số đo | BR-003 |

## Kiểm tra orphan

- Screen không có US/BR: không.
- BR không có enforcement point: không (BR-001…BR-043 đều có neo).
- BR chỉ tồn tại ở FE (client-side): BR-043 (một phần), BR-031 cửa sổ 7 ngày hiển thị — BE
  vẫn kiểm tra lại, nên không orphan.
- API không được màn hình nào gọi trong bộ này: API-033 (refund cổng) chỉ dùng ở
  `AdminRefundHistory`/đối soát phía admin — vẫn thuộc SCR-010; API-042 được GHN gọi.
