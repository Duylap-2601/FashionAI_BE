# Business Rules — FLW-001

Ký hiệu đường dẫn: `BE ` = `FashionAI_BE/`, `FE ` = `FashionAI_FE/`.
Cột **Intended** lấy từ SRS/ADR/plan; **Enforced** lấy từ code. `Unknown` khi không có bằng chứng.

---

### BR-001 — Giá bán do server quyết định

- Statement: Giá mỗi dòng đơn lấy từ `Product.price` hoặc giá sale campaign đang hiệu lực; `items[].price` do client gửi bị bỏ qua.
- Type: Calculation
- Condition: Mọi lần `POST /orders` và `POST /orders/quote`.
- Expected behavior: `unitPriceVnd = sale.salePrice ?? product.price`; tổng dòng = `unitPrice × quantity`.
- Exception: Không có nhánh dùng giá client.
- Related US/AC: US-002 / AC-004
- Enforcement point: `BE src/modules/orders/orders.service.ts:buildOrderPricing:1919`; `BE src/modules/orders/dto/create-order.dto.ts:CreateOrderItemDto.price:46` (ghi chú “BE BỎ QUA”); `BE src/modules/sale-campaigns/sale-pricing.service.ts:resolveSaleForProducts:31`
- Intended: yes (`SRS.md` FR-08, `docs/adr/0002-discount-stacking-order.md`)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-002 — Đóng băng dữ liệu tại thời điểm đặt

- Statement: Tên, ảnh, category, brand, chất liệu, giá và snapshot số đo được chép vào `OrderItem`; đổi sản phẩm/số đo sau đó không làm đổi đơn cũ.
- Type: Consistency
- Condition: Tạo đơn thành công.
- Expected behavior: `productNameSnapshot`, `productImageSnapshot`, `price`, `unitPriceVnd`, `lineTotalVnd`, `measurementSnapshot` được ghi trong cùng transaction.
- Exception: Đơn cũ thiếu cột `*Vnd` đọc fallback từ cột Decimal (`BE src/modules/order-issues/utils/issue-refund-amount.util.ts:lineTotalVnd:24`).
- Related US/AC: US-002 / AC-004
- Enforcement point: `BE src/modules/orders/orders.service.ts:create:301`; `BE src/modules/orders/orders.service.ts:buildMeasurementSnapshot:2056`
- Intended: yes (SRS §5 data model)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-003 — Bắt buộc đủ số đo theo loại trang phục

- Statement: Đơn may đo chỉ được tạo khi hồ sơ có đủ trường số đo bắt buộc cho từng `garmentType` trong đơn.
- Type: Validation
- Condition: `POST /orders`.
- Expected behavior: Thiếu trường → 400 với `code: MEASUREMENTS_INCOMPLETE`, `missingFields[]`, `missing[{field,label}]`; không tạo đơn.
- Exception: Không.
- Related US/AC: US-002 / AC-005
- Enforcement point: `BE src/modules/orders/orders.service.ts:create:216`; `BE src/modules/orders/orders.service.ts:create:223`
- Intended: yes (`SRS.md` FR-02, FR-04)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-004 — Quote token có chữ ký, hết hạn sau 5 phút

- Statement: `POST /orders/quote` trả `quoteToken` ký HMAC trên `(userId, fingerprint, total, expiresAt)`; `POST /orders` từ chối token sai/hết hạn/không khớp giá.
- Type: Validation / Consistency
- Condition: Client gửi `quoteToken` (tuỳ chọn).
- Expected behavior: Token hợp lệ và còn hạn → chấp nhận; sai → 400 `QUOTE_EXPIRED`; lệch fingerprint/giá → `QUOTE_CHANGED`.
- Exception: Không gửi token vẫn đặt được; giá vẫn do server tính lại.
- Related US/AC: US-002 / AC-006
- Enforcement point: `BE src/modules/orders/orders.service.ts:quote:140`; `BE src/modules/orders/orders.service.ts:signQuote:1853`; `BE src/modules/orders/orders.service.ts:assertQuoteToken:1859`
- Intended: yes (`plans/order-payment-shipping-staging-plan.md`)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-005 — Tổng tiền phải khớp và dương

- Statement: `total = itemsTotal + shippingFee − discount`; `discount ≤ itemsTotal + shippingFee`; `total > 0`; nếu client gửi `totalAmount` thì phải bằng tổng server tính.
- Type: Calculation / Validation
- Condition: Mọi lần tạo đơn.
- Expected behavior: Vi phạm → 400 (“Số tiền giảm giá vượt quá giá trị đơn hàng”, “Giá trị đơn hàng phải lớn hơn 0”, “Tổng tiền không khớp: FE gửi X, BE tính Y”).
- Exception: Không.
- Related US/AC: US-002 / AC-006
- Enforcement point: `BE src/modules/orders/orders.service.ts:buildOrderPricing:1943`; `BE src/modules/orders/orders.service.ts:create:249`; `BE src/modules/orders/orders.service.ts:create:258`
- Intended: yes (`SRS.md` FR-08)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-006 — Điều kiện và cấp phát mã giảm giá

- Statement: Mã phải tồn tại, đang bật, trong khoảng thời gian, đạt `minOrderVnd`, còn `usageLimit`, chưa vượt `usageLimitPerUser`; lượt dùng được “claim” nguyên tử khi commit đơn.
- Type: Validation / Constraint
- Condition: `couponCode` khác rỗng.
- Expected behavior: `PERCENTAGE` = `round(itemsTotal×value/100)` chặn bởi `maxDiscountVnd`; `FIXED` = `min(value, itemsTotal)`; mã hết lượt → 409 `COUPON_EXHAUSTED`/`COUPON_USER_LIMIT`; đơn hủy/hết hạn trả lại lượt.
- Exception: Mã không dùng → `couponId` null.
- Related US/AC: US-002 / AC-004
- Enforcement point: `BE src/modules/orders/orders.service.ts:resolveDiscountAmount:1999`; `BE src/modules/orders/orders.service.ts:create:364`; `BE src/common/utils/coupon-redemption.util.ts:releaseOrderCouponRedemption`
- Intended: yes (`SRS.md` FR-08)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-007 — Xếp tầng giảm giá: sale trước, coupon sau

- Statement: Giá sale campaign được áp trước; coupon tính trên `itemsTotal` đã giảm sale, không cộng dồn hai coupon.
- Type: Calculation
- Condition: Sản phẩm đang trong campaign và/hoặc có `couponCode`.
- Expected behavior: Campaign sâu nhất theo đơn giá thắng; hoà thì `endsAt` sớm hơn rồi `id` nhỏ hơn.
- Exception: Không có campaign → giá niêm yết.
- Related US/AC: US-002 / AC-004
- Enforcement point: `BE src/modules/sale-campaigns/sale-pricing.service.ts:resolveSaleForProducts:31`; `BE docs/adr/0002-discount-stacking-order.md`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-008 — Phí vận chuyển do GHN báo, tính ở server

- Statement: Phí ship = GHN preview theo địa chỉ người nhận, khối lượng `max(500, Σ qty×500)` gram, kích thước 25×20×8 cm, `insuranceValue = itemsTotal`, `cod = 0`; kết quả cache Redis 5 phút.
- Type: Calculation / Integration
- Condition: Báo giá hoặc tạo đơn.
- Expected behavior: FE không được gửi phí; thiếu cấu hình địa chỉ lấy hàng → 400 `CAPABILITY_DISABLED`; tuyến không giao → 422 `SHIPPING_ROUTE_UNAVAILABLE`.
- Exception: Cache hit dùng lại phí trong TTL.
- Related US/AC: US-002 / AC-004
- Enforcement point: `BE src/modules/orders/orders.service.ts:calculateOrderShippingFee:1972`; `BE src/modules/shipping/shipping.service.ts:calculateFee:58`; `BE src/modules/shipping/shipping.service.ts:SHIPPING_FEE_CACHE_TTL_SECONDS:24`
- Intended: yes (`SRS.md` FR-08)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-009 — Địa chỉ giao hàng phải map được GHN 2 cấp và đúng phiên bản

- Statement: Đơn phải có đúng một trong `shippingAddressId`/`shippingInfo`; địa chỉ sổ phải khớp `version` client đã xác nhận; tỉnh/phường phải tồn tại trong catalog GHN post-merger đang publish.
- Type: Validation
- Condition: Tạo đơn hoặc lưu địa chỉ.
- Expected behavior: Sai → `ADDRESS_INVALID`, `ADDRESS_VERSION_CONFLICT`, “Tỉnh/Thành sau sáp nhập không hợp lệ.”, “Phường/Xã không thuộc Tỉnh/Thành đã chọn.”.
- Exception: Địa chỉ nhập tay không có GHN id → chặn ở bước tính phí (`ADDRESS_INVALID`).
- Related US/AC: US-002 / AC-004
- Enforcement point: `BE src/modules/orders/orders.service.ts:resolveOrderAddress:1789`; `BE src/modules/orders/orders.service.ts:create:270`; `BE src/modules/shipping/shipping.service.ts:validateGhnLocation:131`
- Intended: yes (`plans/ghn-post-merger-address-migration-plan.md`)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-010 — Chỉ thanh toán online, không COD

- Statement: Đơn may đo mới chỉ nhận `paymentMethod ∈ {BANK_TRANSFER, BANK, SEPAY}`.
- Type: Validation
- Condition: `POST /orders`.
- Expected behavior: Giá trị khác → 400 “Đơn may đo mới chỉ hỗ trợ thanh toán online, không hỗ trợ COD.”
- Exception: Không.
- Related US/AC: US-003 / AC-009
- Enforcement point: `BE src/modules/orders/orders.service.ts:create:175`; `BE src/modules/orders/constants/order-flow.constants.ts:ONLINE_PAYMENT_METHODS:4`
- Intended: **no** — `SRS.md` còn ghi COD (xem BUG-001)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-011 — Idempotency key chống tạo đơn trùng

- Statement: `(userId, idempotencyKey)` là duy nhất; cùng key + cùng fingerprint trả lại đơn cũ; cùng key + payload khác → 409.
- Type: Consistency
- Condition: Client gửi `idempotencyKey`.
- Expected behavior: Lần đầu tạo đơn; lần lặp không tạo thêm `Order`, không claim thêm coupon.
- Exception: Không gửi key → không chống trùng.
- Related US/AC: US-002 / AC-008
- Enforcement point: `BE src/modules/orders/orders.service.ts:create:182`; `BE src/modules/orders/orders.service.ts:create:355`; `BE prisma/schema.prisma:OrderIdempotencyKey:310`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-012 — Đơn chưa thanh toán tự hủy sau 24 giờ

- Statement: `CREATED` + `paymentStatus PENDING` quá `UNPAID_ORDER_TTL_MS` (24h) bị cron hủy theo lô 100, trả coupon và thông báo khách.
- Type: Workflow / State
- Condition: Cron mỗi 10 phút.
- Expected behavior: `status CANCELLED`, `paymentStatus EXPIRED`, payment placeholder PENDING → EXPIRED, `OrderEvent ORDER_PAYMENT_EXPIRED`; đơn mua gói không gửi thông báo “đơn hàng”.
- Exception: Đơn vừa được webhook ghi PAID thì `updateMany` không khớp → bỏ qua.
- Related US/AC: US-003 / AC-034
- Enforcement point: `BE src/modules/orders/orders.service.ts:expireUnpaidOrders:571`; `BE src/modules/orders/constants/order-flow.constants.ts:UNPAID_ORDER_TTL_MS:32`; `BE src/modules/maintenance/maintenance.service.ts:expireUnpaidOrders:79`
- Intended: yes (`SRS.md` FR-08)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-013 — Khách chỉ hủy được đơn chưa thanh toán

- Statement: Chỉ chủ đơn, chỉ `status CREATED`, `paymentStatus ∈ {PENDING, null}` được hủy; cập nhật có điều kiện để chống race với webhook.
- Type: Authorization / State
- Condition: `PATCH /orders/:id/cancel`.
- Expected behavior: Thành công → CANCELLED, payment placeholder EXPIRED, coupon trả lại, event `ORDER_CANCELLED`; race thua → 400 “Đơn hàng vừa được cập nhật trạng thái…”.
- Exception: Đơn đã thu tiền không hủy được qua endpoint này (đi qua admin/refund).
- Related US/AC: US-002 / AC-036
- Enforcement point: `BE src/modules/orders/orders.service.ts:cancel:510`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-014 — Máy trạng thái đơn hàng và trạng thái chỉ hệ thống được đặt

- Statement: Chuyển trạng thái phải nằm trong `ORDER_STATUS_TRANSITIONS`; với `fulfillmentFlowVersion = 1`, `CONFIRMED` bị loại; `SHIPPING`, `DELIVERED`, `PAID`, `CREATED` không được admin đặt.
- Type: State
- Condition: `PATCH /orders/:id/status`.
- Expected behavior: Hợp lệ → cập nhật + `OrderEvent STATUS_CHANGED` + notification (+ email với `PROCESSING`/`CANCELLED`); không hợp lệ → 400 kèm danh sách trạng thái cho phép.
- Exception: Webhook thanh toán/vận chuyển, confirm-delivery và dispute ghi trực tiếp, không qua map (xem 09-audit F-05).
- Related US/AC: US-004, US-008 / AC-026, AC-031
- Enforcement point: `BE src/modules/orders/constants/order-flow.constants.ts:ORDER_STATUS_TRANSITIONS:36`; `BE src/modules/orders/orders.service.ts:updateStatus:697`
- Intended: yes
- Enforced: yes (chỉ với endpoint admin)
- Confidence: High
- Verification: Code-verified

---

### BR-015 — Chống ghi đè cạnh tranh bằng `expectedStatus`

- Statement: Nếu client gửi `expectedStatus` khác trạng thái hiện tại → 409; nếu trạng thái đích trùng hiện tại → no-op trả về đơn.
- Type: Consistency
- Condition: `PATCH /orders/:id/status`.
- Expected behavior: 409 “Đơn hàng đã được cập nhật bởi thao tác khác. Vui lòng tải lại.”
- Exception: Không gửi `expectedStatus` thì bỏ qua kiểm tra.
- Related US/AC: US-008 / AC-026
- Enforcement point: `BE src/modules/orders/orders.service.ts:updateStatus:711`; `BE src/modules/orders/orders.service.ts:updateStatus:719`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-016 — Chỉ tạo link thanh toán cho đơn hợp lệ của chính khách

- Statement: `orderId` phải thuộc user, `status CREATED`, `paymentStatus PENDING`, có item (hoặc `targetTier`), `amount > 0`, đủ địa chỉ + GHN province/ward.
- Type: Authorization / Validation
- Condition: `POST /payments/checkout`.
- Expected behavior: Sai → 404/400; đơn đã PAID → “Đơn hàng này đã được thanh toán.”
- Exception: Đơn mua gói đi nhánh `createSubscriptionOrder`.
- Related US/AC: US-003 / AC-010
- Enforcement point: `BE src/modules/payments/payments.service.ts:resolveProductOrder:140`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-017 — ZaloPay callback phải qua MAC và đúng app

- Statement: Callback `{data, mac}` được SDK verify bằng key2; `app_id` trong data phải bằng `ZALOPAY_APP_ID`; callback chỉ báo trạng thái thành công và mang `zp_trans_id`.
- Type: Integration / Security
- Condition: `POST /payments/zalopay/callback`.
- Expected behavior: Hợp lệ → xử lý PAID; lỗi 4xx → ack `return_code 2` để cổng retry; 5xx → throw.
- Exception: Không có timestamp check; chống lặp bằng `eventKey`.
- Related US/AC: US-003 / AC-011
- Enforcement point: `BE src/modules/payments/zalopay/zalopay.gateway.ts:parseCallback:78`; `BE src/modules/payments/zalopay/zalopay-ack.util.ts:toZaloPayAck:3`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-018 — Chữ ký SePay và chế độ fail-closed ở production

- Statement: `sepay-ipn` chấp nhận HMAC `SHA256(timestamp + "." + rawBody)` **hoặc** shared secret `x-secret-key`; `sepay-webhook` chỉ chấp nhận HMAC; sai/thiếu secret ở production → 400.
- Type: Security / Integration
- Condition: Webhook SePay.
- Expected behavior: Timestamp lệch > 300s → từ chối; non-production thiếu secret → bỏ qua kiểm tra (fail-open) và log warning.
- Exception: Fail-open ngoài production là hành vi có chủ đích cho dev.
- Related US/AC: US-003 / AC-011
- Enforcement point: `BE src/modules/payments/payments.service.ts:verifySePayIPNSignature:1290`; `BE src/modules/payments/payments.service.ts:verifySePayHmac:1352`
- Intended: yes (`SRS.md` NFR security: “Payment webhooks: HMAC verified in production”)
- Enforced: một phần (IPN có đường shared-secret không HMAC)
- Confidence: High
- Verification: Code-verified

---

### BR-019 — Sai số tiền/requestId không được ghi PAID

- Statement: Khi cổng báo SUCCESS nhưng `requestId` hoặc số tiền không khớp, payment chuyển `REFUND_REQUIRED`, ghi `WebhookFailure`, trả lỗi; khi cổng báo thất bại/hết hạn (amount = 0) chỉ đánh dấu FAILED.
- Type: Consistency / Error handling
- Condition: Callback/IPN.
- Expected behavior: Đơn giữ nguyên trạng thái; khoản tiền đã thu được đưa vào hàng chờ hoàn.
- Exception: `MANUAL_ADMIN` bỏ qua kiểm tra số tiền vì luôn truyền `order.amount`.
- Related US/AC: US-003 / AC-012, AC-013
- Enforcement point: `BE src/modules/payments/payments.service.ts:applyGatewayPaymentResult:520`; `BE src/modules/payments/payments.service.ts:applyGatewayPaymentResult:528`; `BE src/modules/payments/payments.service.ts:markRefundRequiredIfCollected:616`
- Intended: yes (`plans/sepay-to-zalopay-migration-plan.md`)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-020 — Webhook xử lý đúng một lần

- Statement: Mỗi sự kiện có `eventKey` duy nhất trong `WebhookEvent`; đơn được “claim” bằng `UPDATE ... WHERE status=CREATED AND paymentStatus=PENDING`; `(provider, transactionId)` và `(provider, providerPaymentId)` là duy nhất.
- Type: Consistency
- Condition: Mọi callback/webhook trùng.
- Expected behavior: Lặp → `DUPLICATE`/`ignored`, không đổi trạng thái, không chạy lại side effect.
- Exception: Hai provider khác nhau (IPN vs bank webhook) được chặn bởi claim đơn.
- Related US/AC: US-003 / AC-035
- Enforcement point: `BE src/modules/payments/payments.service.ts:applyGatewayPaymentResult:535`; `BE src/modules/payments/payments.service.ts:processOrderSuccess:1547`; `BE prisma/schema.prisma:WebhookEvent:1037`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-021 — Sau thanh toán: đơn sản phẩm sang duyệt số đo

- Statement: Đơn sản phẩm PAID chuyển `CREATED → MEASUREMENT_REVIEW`; đơn mua gói chuyển `COMPLETED`; `paymentStatus = PAID`, `amountPaidVnd = amount`, link checkout bị xoá.
- Type: State
- Condition: Xác nhận thanh toán thành công.
- Expected behavior: Không dùng `OrderStatus.PAID`.
- Exception: Đơn không còn CREATED/PENDING → từ chối ghi nhận và đưa vào diện hoàn tiền.
- Related US/AC: US-003, US-004 / AC-011
- Enforcement point: `BE src/modules/payments/payments.service.ts:processOrderSuccess:1536`; `BE src/modules/payments/payments.service.ts:processOrderSuccess:1547`
- Intended: yes (flow v1; `plans/order-status-simplification-plan.md`)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-022 — Side effect sau thanh toán không được làm hỏng webhook

- Statement: Dọn giỏ, enqueue GA4 purchase qua outbox, notification realtime và email xác nhận chạy sau commit; lỗi từng bước bị nuốt và log.
- Type: Consistency / Integration
- Condition: Lần claim PAID thành công.
- Expected behavior: Mỗi đơn enqueue đúng một outbox event `PAYMENT_POST_SUCCESS`.
- Exception: Lỗi Redis/queue không làm fail webhook.
- Related US/AC: US-003 / AC-011
- Enforcement point: `BE src/modules/payments/payments.service.ts:processOrderSuccess:1644`; `BE src/modules/payments/payments.service.ts:processOrderSuccess:1663`; `BE src/modules/payments/payments.service.ts:processOrderSuccess:1696`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-023 — Giỏ được dọn sau khi thanh toán

- Statement: Sau khi đơn sản phẩm PAID, các dòng đã mua bị xoá khỏi giỏ server trên mọi thiết bị.
- Type: Consistency
- Condition: Thanh toán thành công (không áp dụng đơn mua gói).
- Expected behavior: `cartService.removePurchasedItems(order.userId, order.items)`; lỗi chỉ log.
- Exception: Chạy sau commit nên webhook lặp không xoá hai lần.
- Related US/AC: US-001 / AC-003
- Enforcement point: `BE src/modules/payments/payments.service.ts:processOrderSuccess:1644`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-024 — Cổng duyệt số đo

- Statement: Không thể `MEASUREMENT_REVIEW → MEASUREMENT_CONFIRMED` khi còn yêu cầu bổ sung số đo đang mở; review đã gửi được resolve trong cùng giao dịch; hủy đơn đóng mọi review.
- Type: State / Workflow
- Condition: Admin chuyển `MEASUREMENT_CONFIRMED` hoặc `CANCELLED`.
- Expected behavior: Còn review mở → 400; hợp lệ → resolve review SUBMITTED, ghi event.
- Exception: Không.
- Related US/AC: US-004 / AC-015
- Enforcement point: `BE src/modules/orders/orders.service.ts:updateStatus:741`; `BE src/modules/orders/orders.service.ts:assertNoOpenMeasurementReviews:2137`; `BE src/modules/orders/orders.service.ts:resolveSubmittedMeasurementReviews:2148`
- Intended: yes (`plans/order-status-simplification-plan.md`)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-025 — Điều kiện tạo vận đơn và giá trị khai báo BH

- Statement: Vận đơn chỉ tạo cho đơn `fulfillmentFlowVersion=1`, `READY_TO_SHIP`, `PAID`, địa chỉ có GHN province/ward; giá trị khai báo = `Σ price×qty` (không gồm ship/giảm giá); request idempotent theo `requestKey` hoặc `updatedAt`.
- Type: Constraint / Integration
- Condition: `POST /orders/:id/shipment`.
- Expected behavior: Sai điều kiện → 400 “Chỉ tạo vận đơn cho đơn may đo READY_TO_SHIP đã thanh toán.”; thành công → `Shipment` + `providerOrderCode` + `OrderEvent SHIPMENT_CREATED`.
- Exception: Đã có vận đơn active có mã → trả lại vận đơn đó.
- Related US/AC: US-008 / AC-027
- Enforcement point: `BE src/modules/orders/orders.service.ts:createShipment:1478`; `BE src/modules/shipping/utils/shipment-insurance.util.ts:shipmentInsuranceValueVnd:10`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-026 — Chỉ hủy vận đơn trước khi hãng lấy hàng

- Statement: Trạng thái cho phép hủy: `PENDING, FAILED, CREATED, READY_TO_PICK, PICKING`; đã `PICKED/SHIPPING/DELIVERING/RETURNING` → 400; trạng thái kết thúc → no-op.
- Type: State
- Condition: `POST /admin/shipments/:id/cancel` hoặc `POST /orders/:id/shipment/cancel`.
- Expected behavior: Hợp lệ → gọi GHN (nếu có mã) + `Shipment CANCELLED` + event; không đổi trạng thái đơn.
- Exception: Lỗi GHN ở luồng admin được ném ra; luồng outbox cũ nuốt lỗi (dead code).
- Related US/AC: US-008 / AC-028
- Enforcement point: `BE src/modules/shipping/admin-shipments.service.ts:cancel:108`; `BE src/modules/shipping/constants/shipment-status.constants.ts:SHIPMENT_CANCELLABLE_STATUSES:5`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-027 — GHN webhook: secret tuỳ cấu hình, chống lặp, chống lùi

- Statement: `GHN_WEBHOOK_SECRET` nếu đặt thì phải khớp header/query; `eventKey = GHN:{code}:{type}:{time}` duy nhất; sự kiện cũ hơn mốc đã lưu bị đánh dấu stale và bỏ qua.
- Type: Security / Consistency
- Condition: `POST /webhooks/shipping/ghn`.
- Expected behavior: Hợp lệ → cập nhật shipment 1 lần, ghi `OrderEvent`, thông báo; trùng/cũ → `{ignored:true}` + audit.
- Exception: Không cấu hình secret → không kiểm tra.
- Related US/AC: US-005 / AC-019
- Enforcement point: `BE src/modules/shipping/shipping.service.ts:handleGhnWebhook:228`; `BE src/modules/shipping/shipping.service.ts:handleShippingStatus:260`; `BE src/modules/shipping/shipping.service.ts:verifyWebhookSecret:404`
- Intended: yes
- Enforced: một phần (secret optional)
- Confidence: High
- Verification: Code-verified

---

### BR-028 — Ánh xạ trạng thái vận chuyển sang trạng thái đơn (chỉ tiến)

- Statement: `DELIVERED` đẩy đơn từ `READY_TO_SHIP|SHIPPING → DELIVERED`; các mốc đã rời shop (`PICKED, SHIPPING, IN_TRANSIT, DELIVERING, DELIVERY_FAILED, RETURNING, RETURNED`) đẩy `READY_TO_SHIP → SHIPPING`; trạng thái khác giữ nguyên đơn.
- Type: State
- Condition: Webhook/sync/simulator.
- Expected behavior: `updateMany` có điều kiện trạng thái cũ; ghi history + thông báo khi đổi.
- Exception: Đơn đã ở trạng thái khác → không ghi đè.
- Related US/AC: US-005 / AC-019
- Enforcement point: `BE src/modules/orders/utils/shipment-order-status.util.ts:orderStatusForShipment:22`; `BE src/modules/shipping/shipping.service.ts:handleShippingStatus:338`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-029 — Xác nhận nhận hàng cần hãng đã báo giao

- Statement: Khách chỉ xác nhận khi đơn ở `DELIVERY_CONFIRMABLE_STATUSES` **và** vận đơn hiện tại có mốc giao của hãng; kết quả là `COMPLETED`.
- Type: State
- Condition: `POST /orders/:id/confirm-delivery`.
- Expected behavior: Thiếu mốc giao → 400 “Chỉ có thể xác nhận khi đơn vị vận chuyển đã giao hàng.”
- Exception: Không có vận đơn → không xác nhận được.
- Related US/AC: US-005 / AC-017
- Enforcement point: `BE src/modules/orders/orders.service.ts:confirmDelivery:1564`; `BE src/modules/orders/constants/order-flow.constants.ts:DELIVERY_CONFIRMABLE_STATUSES:185`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-030 — Báo chưa nhận hàng trong 7 ngày

- Statement: Đơn `READY_TO_SHIP|SHIPPING|DELIVERED`, hãng đã báo giao, trong `DELIVERY_DISPUTE_WINDOW_MS` (7 ngày); mỗi đơn một dispute mở.
- Type: Workflow
- Condition: `POST /orders/:id/delivery-dispute`.
- Expected behavior: Hợp lệ → `DELIVERY_DISPUTED` + evidence ≤5 ảnh/10MB + thông báo admin; admin resolve → COMPLETED/CANCELLED.
- Exception: Quá hạn/không có mốc giao/đã có dispute → 400.
- Related US/AC: US-005 / AC-018
- Enforcement point: `BE src/modules/orders/orders.service.ts:createDeliveryDispute:1644`; `BE src/modules/orders/constants/order-flow.constants.ts:DELIVERY_DISPUTE_WINDOW_MS:200`
- Intended: yes (`plans/order-payment-shipping-staging-plan.md`)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-031 — Điều kiện mở yêu cầu đổi trả

- Statement: Đơn phải `COMPLETED` hoặc đang trong luồng trả (`RETURN_REQUESTED|RETURN_APPROVED|RETURNING`), và trong 7 ngày kể từ event `COMPLETED`. `REFUND_NOT_RECEIVED` có điều kiện riêng: refund đã COMPLETED trong 7 ngày, không có báo cáo PENDING.
- Type: Workflow
- Condition: `POST /orders/:orderId/items/:orderItemId/issues`.
- Expected behavior: Sai → 400 với thông điệp tương ứng; hợp lệ → issue PENDING, đơn COMPLETED chuyển RETURN_REQUESTED.
- Exception: Issue mới cho item khác trong cùng luồng trả vẫn được tạo.
- Related US/AC: US-006 / AC-020
- Enforcement point: `BE src/modules/order-issues/order-issues.service.ts:create:125`; `BE src/modules/order-issues/order-issues.service.ts:assertWithinIssueWindow:659`; `BE src/modules/order-issues/order-issues.service.ts:assertRefundNotReceivedEligible:619`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-032 — Dữ liệu yêu cầu đổi trả và giới hạn một yêu cầu/item

- Statement: Bắt buộc ≥1 ảnh minh chứng (jpeg/png/webp, ≤10MB); bắt buộc bankName, accountNumber `^[0-9]{6,20}$`, accountHolder; mỗi item chỉ một issue `PENDING|APPROVED|RESOLVED` (refund-not-received: `PENDING|APPROVED`); chỉ hoàn tiền, không đổi hàng; không có trường số lượng.
- Type: Validation / Constraint
- Condition: Tạo issue.
- Expected behavior: Thiếu ảnh/STK sai → 400; item đã có issue → 400 “Sản phẩm này đã có yêu cầu xử lý…”.
- Exception: Ảnh tối đa thực tế không bị chặn ở BE (xem BUG-011).
- Related US/AC: US-006 / AC-021, AC-022
- Enforcement point: `BE src/modules/order-issues/order-issues.service.ts:create:154`; `BE src/modules/order-issues/order-issues.service.ts:create:177`; `BE src/modules/order-issues/dto/create-order-issue.dto.ts:26`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-033 — Tiền hàng hoàn trừ giảm giá theo tỷ lệ món

- Statement: `refundGoods = lineTotal − discount × (lineTotal / itemsSubtotal)`, làm tròn, sàn 0; chỉ tính món bị lỗi, không gộp phí ship.
- Type: Calculation
- Condition: Admin duyệt issue (không phải refund-not-received).
- Expected behavior: Đơn cũ thiếu cột `*Vnd` dùng cột Decimal và tổng dòng.
- Exception: Không.
- Related US/AC: US-007 / AC-023
- Enforcement point: `BE src/modules/order-issues/utils/issue-refund-amount.util.ts:issueRefundAmountVnd:35`
- Intended: yes (commit “hoàn tiền theo món bị lỗi”)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-034 — Phí ship là khoản hoàn riêng, tối đa một lần/đơn

- Statement: Hoàn phí ship ban đầu (`shippingFeeVnd ?? shippingFee`) thành `Refund.kind = SHIPPING`; mặc định hoàn khi lý do thuộc lỗi shop (`WRONG_SIZE`, `WRONG_COLOR`, `QUALITY_MISMATCH`); mỗi đơn chỉ một khoản SHIPPING không bị hủy/failed.
- Type: Calculation / Workflow
- Condition: Admin duyệt issue; `refundShipping` có thể ghi đè.
- Expected behavior: Bỏ trống `refundShipping` ⇒ hành vi mặc định theo lý do; đã có khoản SHIPPING ⇒ bỏ qua.
- Exception: Phí ship 0 → không tạo khoản.
- Related US/AC: US-007 / AC-023
- Enforcement point: `BE src/modules/order-issues/order-issues.service.ts:review:495`; `BE src/modules/order-issues/utils/issue-refund-amount.util.ts:SHOP_FAULT_ISSUE_REASONS:6`
- Intended: yes (commit “hoàn toàn bộ phí ship ban đầu, một lần mỗi đơn”)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-035 — Điều kiện chốt hoàn tiền

- Statement: Không chốt `COMPLETED` khi đơn còn `RETURN_REQUESTED|RETURN_APPROVED|RETURNING`; không chốt tay khi có refund cổng đang chạy; phải đã thu tiền; `COMPLETED` cần ≥1 ảnh chứng từ; số tiền ≤ phần còn lại.
- Type: Validation / State
- Condition: `PATCH /orders/:id/refund` hoặc finalize refund cổng.
- Expected behavior: Vi phạm → 400 với thông điệp tương ứng; hợp lệ → `Refund` COMPLETED, `amountRefundedVnd` cộng dồn.
- Exception: `REFUND_NOT_RECEIVED` mở lại khoản cũ thay vì tạo mới.
- Related US/AC: US-007, US-009 / AC-024, AC-030
- Enforcement point: `BE src/modules/orders/orders.service.ts:updateRefund:1077`; `BE src/common/utils/refund.util.ts:resolveManualRefundAmount:19`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-036 — Rollup trạng thái thanh toán sau hoàn tiền

- Statement: `paymentStatus` = `PAID` khi chưa hoàn đồng nào, `PARTIALLY_REFUNDED` khi hoàn một phần, `REFUNDED` khi hoàn đủ/vượt số đã thu; `PROCESSING` khi refund đang chạy.
- Type: Calculation / Consistency
- Condition: Mọi thay đổi refund.
- Expected behavior: Tính từ `amountPaidVnd` và tổng refund COMPLETED.
- Exception: Refund `PAYMENT_ONLY` (thu trùng) không trừ vào hạn mức hoàn của đơn.
- Related US/AC: US-007 / AC-024
- Enforcement point: `BE src/common/utils/refund.util.ts:resolveRefundPaymentStatus:11`; `BE src/modules/orders/orders.service.ts:updateRefund:1240`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-037 — Mở lại khoản hoàn khi khách báo chưa nhận tiền

- Statement: Chỉ khi `refundStatus COMPLETED`, lần hoàn gần nhất trong 7 ngày, không có báo cáo REFUND_NOT_RECEIVED đang PENDING; khoản MANUAL gần nhất → FAILED, tính lại `amountRefundedVnd`, `refundStatus REQUIRED`, event `REFUND_REOPENED`.
- Type: Workflow
- Condition: Admin duyệt issue `REFUND_NOT_RECEIVED`.
- Expected behavior: Khoản hoàn được chuyển lại; refund cổng không mở lại được.
- Exception: Hết hạn 7 ngày → 400.
- Related US/AC: US-007 / AC-025
- Enforcement point: `BE src/modules/orders/orders.service.ts:reopenRefundNotReceived:1375`; `BE src/modules/order-issues/order-issues.service.ts:review:459`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-038 — Issue chỉ RESOLVED khi mọi khoản hoàn đã chốt

- Statement: Duyệt issue đặt `APPROVED`; `RESOLVED` chỉ được ghi trong luồng refund khi không còn `Refund` MANUAL mở (REQUIRED/PENDING/PROCESSING) cho đơn.
- Type: State
- Condition: Duyệt issue / chốt refund.
- Expected behavior: Issue hiển thị “Chờ hoàn tiền” cho tới khoản cuối COMPLETED.
- Exception: Từ chối → REJECTED kèm lý do bắt buộc.
- Related US/AC: US-009 / AC-029, AC-031
- Enforcement point: `BE src/modules/orders/orders.service.ts:updateRefund:1246`; `BE src/modules/order-issues/order-issues.service.ts:review:438`
- Intended: yes (commit “duyệt để chờ hoàn tiền, hoàn xong mới đã giải quyết”)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-039 — Hoàn tiền qua cổng: chỉ cổng hỗ trợ, có hạn mức, idempotent

- Statement: Chỉ `MOMO`/`ZALOPAY` hoàn online; payment `PAID|REFUND_REQUIRED` có `transactionId`; số tiền ≤ `paidAmount − Σ(PENDING|PROCESSING|COMPLETED refunds)`; `Refund.idempotencyKey` duy nhất.
- Type: Integration / Calculation
- Condition: `POST /payments/admin/:paymentId/refunds`.
- Expected behavior: Cổng trả PENDING → refund PROCESSING và cron đối soát; trả lỗi → FAILED + hoàn trạng thái đơn.
- Exception: `SEPAY` phải dùng luồng chuyển khoản tay.
- Related US/AC: US-009 / AC-030
- Enforcement point: `BE src/modules/payments/payments.service.ts:refundGatewayPayment:711`; `BE src/modules/payments/payments.service.ts:refundGatewayPayment:748`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-040 — Xác nhận thanh toán thủ công và gợi ý đối soát

- Statement: Admin xác nhận tay theo `orderCode` với `reference/note`; hệ thống chạy `processOrderSuccess` dưới provider `MANUAL_ADMIN`. Giao dịch chuyển khoản lạ được liệt kê kèm tối đa 5 đơn PENDING cùng số tiền trong ±24h; không tự đổi trạng thái.
- Type: Workflow / Error handling
- Condition: Webhook không tới hoặc giao dịch không khớp mã đơn.
- Expected behavior: Xác nhận → PAID như luồng thường, khoá chống trùng theo `orderCode`; gợi ý chỉ để admin chọn.
- Exception: Không kiểm tra chứng từ ngân hàng ngoài quyền admin.
- Related US/AC: US-010 / AC-033
- Enforcement point: `BE src/modules/payments/payments.service.ts:confirmManualPayment:1096`; `BE src/modules/payments/payments.service.ts:listUnmatchedTransactions:1165`
- Intended: yes (commit “xác nhận tay hai đơn cùng ghi chú”)
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-041 — Sổ webhook lỗi để đối soát

- Statement: Mọi webhook không xử lý được ghi `WebhookFailure` (provider, code, message, payload, orderCode) và có thể đánh dấu resolved; ghi lỗi là best-effort.
- Type: Error handling / Observability
- Condition: Webhook sai/không khớp/trùng.
- Expected behavior: Admin xem `GET /payments/admin/webhook-failures?resolved=`, resolve bằng PATCH.
- Exception: Lỗi DB khi ghi failure bị nuốt.
- Related US/AC: US-010 / AC-032
- Enforcement point: `BE src/modules/payments/payments.service.ts:recordWebhookFailure:1116`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-042 — Phân quyền endpoint

- Statement: Endpoint admin yêu cầu JWT + `Role.ADMIN`; endpoint khách chỉ thao tác trên đơn của mình; webhook là public nhưng phải qua chữ ký/secret.
- Type: Authorization
- Condition: Mọi request.
- Expected behavior: Thiếu quyền → 401/403.
- Exception: `GET /order-issues/mine` nằm trong admin controller nhưng chỉ cần JWT (xem BUG-013).
- Related US/AC: US-008, US-009, US-010 / AC-026
- Enforcement point: `BE src/modules/orders/orders.controller.ts:RolesGuard:94`; `BE src/modules/payments/payments.controller.ts:Roles:123`; `BE src/modules/order-issues/admin-order-issues.controller.ts:Roles:47`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified

---

### BR-043 — Quy tắc giỏ hàng

- Statement: Khách chưa đăng nhập dùng giỏ local (`stale_cart`); đăng nhập thì merge vào giỏ server (giữ số lượng lớn hơn); số lượng server kẹp 1…1000; payload merge tối đa 50 dòng; món không còn bán không được đưa vào đơn.
- Type: Constraint / Consistency
- Condition: Thao tác giỏ.
- Expected behavior: Merge xong xoá giỏ guest; đăng xuất xoá giỏ guest; món unavailable hiển thị mờ và bị loại khỏi tổng.
- Exception: Giỏ guest không có chặn trên số lượng (chỉ giỏ server kẹp).
- Related US/AC: US-001 / AC-001, AC-002
- Enforcement point: `FE src/features/cart/store/cartStore.ts:useCartStore:47`; `FE src/features/cart/services/cart-sync.ts:decideCartSyncAction:90`; `FE src/features/cart/services/cart-mapper.ts:clampCartQuantity:27`; `BE src/modules/cart/cart.service.ts:addItem:54`
- Intended: yes
- Enforced: yes
- Confidence: High
- Verification: Code-verified
