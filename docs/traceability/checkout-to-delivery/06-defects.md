# Defects — FLW-001

Không có defect nào được xác nhận bằng runtime E2E trong bộ này. Các mục dưới đây là
**defect** khi có bằng chứng code path chắc chắn (ví dụ chuỗi ký tự không thể khớp), còn
lại là **defect candidate** cần một lần chạy staging để xác nhận. Không mục nào được
tính là `FAIL` trong báo cáo trừ khi có `EXEC` tương ứng.

---

### BUG-001 — SRS mô tả COD và trừ/hoàn kho, code không có

- Severity: High
- Priority: P1
- Status: Open
- Related: BR-010, OQ-001, US-003/AC-009
- Environment: tài liệu vs `FashionAI_BE` HEAD `1f6319c`
- Description: `SRS.md` (FR-08, §5, §6) vẫn ghi COD, “stock decrement on COD CONFIRMED / online PAID” và `Product.stock`; code từ chối COD và schema không còn cột stock.
- Reproduction:
  1. Đọc `SRS.md:219-232`.
  2. Đọc `prisma/schema.prisma:Product:506`.
  3. Gửi `POST /orders` với `paymentMethod: "COD"`.
- Expected: Tài liệu và code thống nhất một mô hình (có hoặc không COD/kho).
- Actual: Tài liệu nói có; code trả 400 “Đơn may đo mới chỉ hỗ trợ thanh toán online, không hỗ trợ COD.”; không có cột stock.
- Evidence: `SRS.md:219`; `BE src/modules/orders/orders.service.ts:create:175`; `BE prisma/migrations/20260926183448_remove_product_stock/migration.sql`
- Root cause: SRS không được cập nhật sau migration bỏ stock và quyết định chỉ thanh toán online.
- Resolution đề xuất: sửa SRS theo code, hoặc mở lại yêu cầu COD/kho thành story mới.

### BUG-002 — SePay: mã hóa đơn `ORD-` không khớp parser `FAI`

- Severity: Critical
- Priority: P0
- Status: Open (xác nhận bằng code path; chưa chạy staging)
- Related: BR-018, US-003/AC-011
- Environment: luồng SePay checkout → IPN/bank webhook
- Description: Checkout gửi `order_invoice_number = ORD-<code>`; IPN chỉ chấp nhận `^FAI(\d+)$`; bank webhook chỉ nhận `FAI` trong `code/content`. Mọi thanh toán qua SePay checkout sẽ không được ghi nhận tự động.
- Reproduction:
  1. Tạo đơn, `POST /payments/checkout` với `provider: "SEPAY"` → nhận `checkoutUrl` chứa `ORD-<code>`.
  2. Giả lập IPN `ORDER_PAID` với `order.order_invoice_number = "ORD-<code>"`.
  3. Quan sát `parseSePayOrderCode`.
- Expected: IPN khớp đơn và chuyển PAID.
- Actual: `parseSePayOrderCode` trả `null` → ghi `WebhookFailure PARSE_FAILED`, trả 400, đơn kẹt CREATED.
- Evidence: `BE src/modules/payments/payments.service.ts:createSePayCheckoutLink:290`; `BE src/modules/payments/payments.service.ts:parseSePayOrderCode:1402`; `BE src/modules/payments/payments.service.ts:handleSePayIPN:1027`; `BE src/modules/payments/payments.service.ts:parseSePayPaymentCode:1406`
- Root cause: Đổi prefix hiển thị sang `ORD-` nhưng không cập nhật parser (hoặc ngược lại).
- Resolution đề xuất: chấp nhận cả `ORD-` và `FAI` (hoặc thống nhất một prefix), thêm test hồi quy cho cả IPN và bank webhook.

### BUG-003 — Admin có thể ghi đè `source` của thay đổi trạng thái

- Severity: Medium
- Priority: P2
- Status: Open
- Related: BR-014, BR-042, OQ-005
- Description: `UpdateOrderStatusDto.source` cho phép client chọn `USER|ADMIN|SYSTEM`, nên admin có thể ghi event như do khách/hệ thống tạo.
- Reproduction: `PATCH /orders/:id/status` với `source: "USER"`; đọc `OrderEvent.source`.
- Expected: Nguồn sự kiện do server suy ra từ người gọi.
- Actual: `source` client gửi được ghi nguyên vào event.
- Evidence: `BE src/modules/orders/dto/update-order-status.dto.ts:33`; `BE src/modules/orders/orders.service.ts:updateStatus:787`
- Root cause: DTO dùng cho audit nhưng không bị loại bỏ.
- Resolution đề xuất: bỏ `source` khỏi DTO hoặc chỉ cho phép khi có quyền hệ thống riêng.

### BUG-004 — `OrderStatus.EXPIRED` không bao giờ được ghi

- Severity: Medium
- Priority: P3
- Status: Open
- Related: BR-012, BR-014
- Description: Enum có `EXPIRED` và message “Đơn hàng đã hết hạn thanh toán.”, nhưng cron hết hạn ghi `status = CANCELLED`, `paymentStatus = EXPIRED`.
- Reproduction: Tạo đơn quá 24h, chạy cron; đọc `order.status`.
- Expected: Một trong hai: dùng `EXPIRED` cho đơn hết hạn, hoặc bỏ giá trị enum.
- Actual: `CANCELLED`; FE hiển thị “Đã hủy” thay vì “Hết hạn thanh toán”.
- Evidence: `BE src/modules/orders/orders.service.ts:expireUnpaidOrders:587`; `BE src/modules/orders/constants/order-flow.constants.ts:ORDER_STATUS_MESSAGE:145`
- Root cause: Hai mô hình trạng thái tồn tại song song.
- Resolution đề xuất: chốt semantics, cập nhật map + nhãn FE + test.

### BUG-005 — Nhiều luồng ghi trạng thái bỏ qua transition map

- Severity: Medium
- Priority: P2
- Status: Open (có thể là chủ đích)
- Related: BR-014, US-008/AC-026
- Description: Payment webhook, GHN webhook, `confirmDelivery`, `createDeliveryDispute`, `resolveDeliveryDispute` ghi trực tiếp `order.update/updateMany` thay vì `updateStatus`, nên map chỉ đúng cho endpoint admin.
- Reproduction: Đơn `READY_TO_SHIP` + GHN `delivered` → order DELIVERED dù map chỉ cho `READY_TO_SHIP → DELIVERY_DISPUTED|CANCELLED`.
- Expected: Hoặc mọi luồng đi qua một state machine, hoặc map phải bao gồm các cạnh webhook.
- Actual: Map không phản ánh đủ các cạnh thực tế.
- Evidence: `BE src/modules/shipping/shipping.service.ts:handleShippingStatus:338`; `BE src/modules/payments/payments.service.ts:processOrderSuccess:1547`; `BE src/modules/orders/orders.service.ts:confirmDelivery:1578`
- Root cause: Map được thiết kế cho flow admin, webhook thêm sau.
- Resolution đề xuất: đưa các cạnh webhook vào map hoặc tách map theo actor; thêm test đối chiếu.

### BUG-006 — Cổng báo hủy làm đơn CANCELLED nhưng `paymentStatus` vẫn PENDING

- Severity: Medium
- Priority: P2
- Status: Defect candidate
- Related: BR-013, BR-014
- Description: `markOrderCancelled` chỉ đổi `order.status`, không đổi `paymentStatus`/payment row.
- Reproduction: Giả lập IPN `TRANSACTION_VOID` cho đơn CREATED+PENDING; đọc `order.paymentStatus`.
- Expected: `paymentStatus = EXPIRED` (như luồng hủy của khách).
- Actual: `PENDING`; UI có thể hiện “Chờ thanh toán” trên đơn đã hủy.
- Evidence: `BE src/modules/payments/payments.service.ts:markOrderCancelled:1415`
- Root cause: Hai luồng hủy không dùng chung helper.
- Resolution đề xuất: dùng chung logic cancel/expire, thêm test.

### BUG-007 — `OrderStatus.PAID` và các trạng thái “chết” gây nhầm mô hình

- Severity: Low
- Priority: P3
- Status: Open
- Related: BR-014, OQ-003
- Description: `PAID`, `PENDING`, `PENDING_PAYMENT`, `CONFIRMED`, `QUALITY_CHECK`, `RETURNING` không có writer; `CANONICAL_ORDER_STATUSES` còn bỏ sót 4 giá trị.
- Evidence: `BE src/modules/orders/constants/order-flow.constants.ts:CANONICAL_ORDER_STATUSES:149`; `BE prisma/schema.prisma:OrderStatus:90`
- Expected: Enum phản ánh trạng thái thực dùng; danh sách canonical khớp enum.
- Actual: Tồn tại giá trị không dùng và danh sách thiếu phần tử.
- Resolution đề xuất: dọn enum sau khi migrate dữ liệu cũ, hoặc ghi rõ “legacy”.

### BUG-008 — Trang `/orders/[id]/success` hiển thị dữ liệu giả

- Severity: Medium
- Priority: P2
- Status: Open
- Related: US-003/AC-011, BR-014
- Description: Trang success hard-code mã đơn `id.substring(0,8)`, trạng thái “Đã nhận đơn”, “Dự kiến giao 3–5 ngày làm việc”, banner “Bạn đã được nâng cấp” và ảnh Unsplash.
- Reproduction: Tạo đơn chưa thanh toán, mở `/orders/<uuid>/success`.
- Expected: Trạng thái thật (“Chờ thanh toán”), mã `ORD-<orderCode>`, không banner nâng cấp.
- Actual: Luôn báo đã nhận đơn/đã nâng cấp.
- Evidence: `FE src/features/orders/components/orders-id-success-page.tsx:46`; `:55`; `:60`; `:68`; `:93`
- Root cause: Trang mẫu chưa được nối dữ liệu.
- Resolution đề xuất: dùng `order.status`/`paymentStatus` hoặc xóa trang và redirect về `/orders/:id`.

### BUG-009 — Lỗi tải sổ địa chỉ bị hiển thị thành “chưa có địa chỉ”

- Severity: Low
- Priority: P3
- Status: Open
- Related: US-002/AC-004, BR-009
- Description: `useUserAddresses` chỉ lấy `data/isLoading/refetch`; khi query lỗi, trang hiện “Bạn chưa có địa chỉ giao hàng” và không có nút thử lại riêng.
- Reproduction: Mock `GET /users/me/addresses` trả 500, mở `/checkout`.
- Expected: Thông báo lỗi tải + thử lại.
- Actual: Thông điệp “chưa có địa chỉ”.
- Evidence: `FE src/features/checkout/components/checkout-page.tsx:CheckoutPage:87`; `:476`
- Resolution đề xuất: đọc `isError` và render trạng thái lỗi.

### BUG-010 — Bỏ trống `refundShipping` tự động hoàn phí ship với lỗi shop

- Severity: Medium
- Priority: P2
- Status: Defect candidate (hành vi có thể là chủ đích)
- Related: BR-034
- Description: `refundShipping = dto.refundShipping ?? SHOP_FAULT_ISSUE_REASONS.includes(reason)`; client không gửi field sẽ mặc định hoàn ship cho 3 lý do lỗi shop.
- Reproduction: Gọi review approve với lý do `WRONG_SIZE`, không gửi `refundShipping`.
- Expected: Quyết định hoàn ship phải tường minh.
- Actual: Hoàn ship mặc định.
- Evidence: `BE src/modules/order-issues/order-issues.service.ts:review:495`
- Resolution đề xuất: mặc định `false` và FE gửi rõ, hoặc ghi hành vi vào API docs + test.

### BUG-011 — Audit webhook GHN gây hiểu nhầm

- Severity: Low
- Priority: P3
- Status: Open
- Related: BR-027
- Description: `signatureValid` chỉ được set cho staging simulator; callback thật để `null`, trong khi `WebhookEvent.status` mặc định `PROCESSED` kể cả khi event bị bỏ qua vì trùng/stale.
- Evidence: `BE src/modules/shipping/shipping.service.ts:handleShippingStatus:285`; `BE prisma/schema.prisma:WebhookEvent:1037`
- Resolution đề xuất: ghi `signatureValid` thật và status `IGNORED_DUPLICATE`/`PROCESSED`.

### BUG-012 — Hủy vận đơn không đổi trạng thái đơn, không báo khách

- Severity: Medium
- Priority: P2
- Status: Open
- Related: BR-026, BR-028
- Description: `admin-shipments.service.cancel` chỉ ghi `Shipment CANCELLED` + `OrderEvent`; order giữ `READY_TO_SHIP`/`SHIPPING`, không notification cho khách.
- Reproduction: Hủy vận đơn READY_TO_PICK; mở trang đơn của khách.
- Expected: Đơn về trạng thái chờ tạo lại vận đơn và khách được thông báo.
- Actual: Đơn vẫn “Chờ giao”, khách không biết.
- Evidence: `BE src/modules/shipping/admin-shipments.service.ts:cancel:123`; `BE src/modules/orders/utils/shipment-order-status.util.ts:orderStatusForShipment:22`
- Resolution đề xuất: quyết định trạng thái đơn sau hủy (ví dụ `READY_TO_SHIP`) + notification.

### BUG-013 — `GET /order-issues/mine` nằm trong controller admin nhưng không gate ADMIN

- Severity: Low
- Priority: P3
- Status: Open (không phải lỗ hổng: chỉ trả dữ liệu của chính user)
- Related: BR-042
- Description: Endpoint của khách đặt trong `AdminOrderIssuesController`; class không có `@Roles(ADMIN)` nên hoạt động, nhưng cấu trúc dễ khiến người bảo trì thêm guard sai.
- Evidence: `BE src/modules/order-issues/admin-order-issues.controller.ts:Controller:40`; `:findMine:65`
- Resolution đề xuất: chuyển endpoint sang controller khách.

### BUG-014 — GHN webhook không bắt buộc secret

- Severity: Medium
- Priority: P2
- Status: Open
- Related: BR-027, BR-042
- Description: Nếu `GHN_WEBHOOK_SECRET` không được cấu hình, webhook công khai được xử lý không xác thực; kẻ gọi có thể đẩy trạng thái vận đơn.
- Reproduction: Chạy staging không đặt secret, POST webhook với `Status: delivered`.
- Expected: Fail-closed ở production như SePay.
- Actual: Không kiểm tra.
- Evidence: `BE src/modules/shipping/shipping.service.ts:verifyWebhookSecret:404`
- Resolution đề xuất: bắt buộc secret khi `NODE_ENV=production`.

### BUG-015 — Fallback provider mặc định là MOMO

- Severity: Medium
- Priority: P2
- Status: Defect candidate
- Related: BR-016, BR-017
- Description: Khi `PAYMENT_DEFAULT_PROVIDER` không đặt, registry mặc định `MOMO` — provider không có trong UI checkout; đơn có thể rơi vào cổng không mong muốn.
- Evidence: `BE src/modules/payments/gateways/payment-gateway.registry.ts:constructor:18`; `BE src/modules/payments/payments.service.ts:createCheckoutLink:75`
- Expected: Mặc định trùng với UI (`ZALOPAY`) hoặc bắt buộc client gửi `provider`.
- Actual: MOMO.
- Resolution đề xuất: đổi default + validate env khi khởi động.

### BUG-016 — Không chặn số ảnh minh chứng issue

- Severity: Low
- Priority: P2
- Status: Open
- Related: BR-032
- Description: Swagger ghi tối đa 10 ảnh nhưng controller chỉ kiểm tra từng file ≤10MB; không giới hạn số lượng, có thể upload hàng loạt.
- Evidence: `BE src/modules/order-issues/order-issues.controller.ts:create:101`; `:apiBody:83`
- Expected: 400 khi >10 ảnh.
- Actual: Chấp nhận không giới hạn.
- Resolution đề xuất: thêm guard số file như luồng review (5 ảnh).

### BUG-017 — `GET /orders/:id/tracking` ghi đè trạng thái vận đơn không qua handler chuẩn

- Severity: Medium
- Priority: P3
- Status: Defect candidate
- Related: BR-027, BR-028
- Description: Endpoint tracking gọi GHN rồi ghi thẳng `shipment.status` + `trackingData`, không kiểm tra mốc thời gian, không ghi `OrderEvent`, không đồng bộ order — khác handler webhook.
- Evidence: `BE src/modules/orders/orders.service.ts:getTracking:1761`
- Expected: Dùng chung `handleShippingStatus` hoặc chỉ đọc.
- Actual: Có thể làm lùi trạng thái ship và lệch order.
- Resolution đề xuất: chuyển sang read-only hoặc gọi handler chuẩn.

### BUG-018 — DTO nhận `discountAmount`/`shippingFee` nhưng bỏ qua

- Severity: Low
- Priority: P3
- Status: Open
- Related: BR-001, BR-008
- Description: `CreateOrderDto` khai báo hai trường tiền nhưng pricing không đọc; client gửi giá trị tưởng có hiệu lực.
- Evidence: `BE src/modules/orders/dto/create-order.dto.ts:CreateOrderDto.discountAmount:156`; `:shippingFee:162`; `BE src/modules/orders/orders.service.ts:buildOrderPricing:1907`
- Resolution đề xuất: xóa khỏi DTO (giữ `totalAmount` để double-check).

### BUG-019 — Đơn vị “tự tạo vận đơn sau CONFIRMED” chỉ còn là dead code

- Severity: Low
- Priority: P3
- Status: Open
- Related: BR-025
- Description: `ShipmentService.createShipmentFromOrder` không có caller; outbox handler `SHIPMENT_CREATE_REQUESTED` chỉ log “Legacy shipment create job skipped”; comment vẫn nói tự động.
- Evidence: `BE src/modules/shipping/shipment.service.ts:createShipmentFromOrder:41`; `BE src/modules/outbox/processors/outbox.processor.ts:handleShipmentCreate:60`
- Resolution đề xuất: xóa code/comment lỗi thời hoặc hoàn thiện producer.

### BUG-020 — `/payment/cancel|error` không phân biệt pending và expired

- Severity: Low
- Priority: P3
- Status: Open
- Related: US-003/AC-013
- Description: Hai trang tĩnh luôn nói “Đơn vẫn chờ thanh toán”, không truy vấn đơn; khách có thể thấy sai khi đơn đã hết hạn.
- Evidence: `FE src/features/payments/components/payment-cancel-page.tsx:PaymentCancelPage:5`
- Resolution đề xuất: đọc `orderId` và hiển thị trạng thái thật.

### BUG-021 — Ảnh success-page và cross-sell dùng URL ngoài

- Severity: Low
- Priority: P3
- Status: Open
- Related: US-003/AC-011
- Description: Trang success tải ảnh Unsplash trực tiếp, không qua loader/Cloudinary, có thể vỡ hoặc lộ request ngoài.
- Evidence: `FE src/features/orders/components/orders-id-success-page.tsx:93`
- Resolution đề xuất: dùng component ảnh chuẩn hoặc xóa cross-sell.
