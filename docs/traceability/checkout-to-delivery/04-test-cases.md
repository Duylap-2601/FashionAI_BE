# Test Scenarios & Test Cases — FLW-001

Test được thiết kế từ US/AC/BR/screen/API, không sao chép happy path của code.
`Status` mặc định `Not Run`; chỉ `PASS` khi có `EXEC` tương ứng ở `05-execution.md`.

## TS-001 — Báo giá và giá bán

### TC-001 — Chọn giá sale sâu nhất và làm tròn theo đơn giá

- Related: US-002 / BR-007
- Type: Calculation
- Priority: High
- Preconditions: Có ≥2 campaign cùng áp cho một sản phẩm.
- Test data: giá niêm yết 1.000.000; campaign A gần hơn nhưng giảm 10%; campaign B giảm 15%.

| # | Action | Expected result |
|---|---|---|
| 1 | Gọi `POST /orders/quote` với sản phẩm đó | `itemsTotal` dùng giá của campaign B |
| 2 | Hai campaign cùng giá, khác `endsAt` | Chọn campaign `endsAt` sớm hơn; hoà nữa thì `id` nhỏ hơn |
| 3 | Không có campaign | Dùng giá niêm yết |

- Expected result: Giá trong quote/bản ghi đơn khớp campaign sâu nhất, làm tròn VND.
- Automation candidate: Yes
- Status: PASS (EXEC-001)

### TC-002 — Fingerprint đơn thay đổi theo comboType

- Related: US-002 / BR-011
- Type: Regression
- Priority: Medium
- Preconditions: Cùng `idempotencyKey`, payload khác `comboType`.
- Test data: 1 item, `comboType` lần lượt bỏ trống và `combo`.

| # | Action | Expected result |
|---|---|---|
| 1 | Tính fingerprint cho hai payload | Hai fingerprint khác nhau |
| 2 | Payload không có `comboType` | Fingerprint giữ nguyên như trước khi thêm trường |

- Expected result: Cùng key + payload khác → 409 `IDEMPOTENCY_CONFLICT`; cùng payload → trả đơn cũ.
- Automation candidate: Yes
- Status: PASS (EXEC-002)

### TC-003 — Mã giảm giá hết lượt / sai điều kiện

- Related: US-002 / BR-006
- Type: Negative
- Priority: High
- Preconditions: Coupon `PERCENTAGE` có `usageLimit`, `minOrderVnd`.
- Test data: đơn dưới min; mã hết hạn; mã hết lượt; user hết lượt.

| # | Action | Expected result |
|---|---|---|
| 1 | Quote với mã dưới giá tối thiểu | 400 “Đơn hàng chưa đạt giá trị tối thiểu để áp mã này” |
| 2 | Hai request đồng thời dùng lượt cuối | Chỉ một đơn được claim; đơn kia 409 `COUPON_EXHAUSTED` |
| 3 | Huỷ đơn đã dùng mã rồi đặt lại | Lượt dùng được trả lại, dùng được lần nữa |

- Expected result: Không đơn nào hưởng quá số lượt; `used_count` không âm.
- Automation candidate: Yes
- Status: Not Run

### TC-004 — Giá client không được tin

- Related: US-002 / BR-001
- Type: Negative
- Priority: Critical
- Preconditions: Sản phẩm ACTIVE giá 800.000.
- Test data: `items[0].price = 1`.

| # | Action | Expected result |
|---|---|---|
| 1 | `POST /orders` với giá 1 | Đơn tạo với giá 800.000 |
| 2 | Gửi `totalAmount` sai theo giá 1 | 400 “Tổng tiền không khớp…” |
| 3 | Sản phẩm chuyển ARCHIVED sau khi quote | Tạo đơn 400 “Sản phẩm không tồn tại hoặc chưa active” |

- Expected result: Không có đường nào để client đặt giá.
- Automation candidate: Yes
- Status: Not Run

### TC-005 — Quote token hết hạn/bị sửa

- Related: US-002 / BR-004, BR-005
- Type: Boundary / Negative
- Priority: High
- Preconditions: Có quote token hợp lệ.
- Test data: token tạo cách đây 6 phút; token sửa 1 ký tự; tổng tiền thay đổi.

| # | Action | Expected result |
|---|---|---|
| 1 | Tạo đơn với token quá 5 phút | 400 `QUOTE_EXPIRED` |
| 2 | Tạo đơn với token bị sửa | 400 “Báo giá không hợp lệ hoặc đã hết hạn.” |
| 3 | Đổi số lượng sau khi quote | 400 `QUOTE_CHANGED`, FE báo giá lại |

- Expected result: Không thể dùng báo giá cũ cho payload mới.
- Automation candidate: Yes
- Status: Not Run

## TS-002 — Vòng đời đơn trước khi giao

### TC-006 — Đơn quá 24 giờ tự hủy, trả coupon, không đụng đơn vừa thanh toán

- Related: US-003 / BR-012
- Type: State
- Priority: High
- Preconditions: Đơn CREATED+PENDING quá TTL; một đơn vừa được webhook ghi PAID.
- Test data: 2 đơn, một có coupon.

| # | Action | Expected result |
|---|---|---|
| 1 | Chạy `expireUnpaidOrders` | Đơn quá hạn CANCELLED, payment PENDING → EXPIRED, event `ORDER_PAYMENT_EXPIRED` |
| 2 | Kiểm tra coupon | `used_count` trả lại đúng một lần; đơn không dùng mã không đổi |
| 3 | Đơn vừa PAID | Bị bỏ qua, không trả coupon, không báo hủy |
| 4 | Đơn mua gói hết hạn | Không gửi thông báo “đơn hàng” |

- Expected result: Chỉ đơn chưa thanh toán bị hủy; coupon nhất quán.
- Automation candidate: Yes
- Status: PASS (EXEC-003)

### TC-007 — Khách hủy đơn

- Related: US-002 / BR-013
- Type: State / Auth
- Priority: High
- Preconditions: Đơn CREATED+PENDING của khách A; đơn PAID của khách A; đơn của khách B.
- Test data: 3 đơn.

| # | Action | Expected result |
|---|---|---|
| 1 | A hủy đơn CREATED | 200, CANCELLED, payment EXPIRED, coupon trả lại |
| 2 | A hủy đơn PAID | 400 “Chỉ có thể hủy đơn hàng đang chờ xử lý” |
| 3 | A hủy đơn của B | 404 |
| 4 | Webhook PAID và hủy chạy đồng thời | Chỉ một bên thắng; bên thua nhận lỗi tải lại |

- Expected result: Không hủy được đơn đã thu tiền; không lộ đơn người khác.
- Automation candidate: Yes
- Status: Not Run

### TC-008 — Chặn trạng thái hệ thống và ghi đè cạnh tranh

- Related: US-008 / AC-016, AC-026 / BR-014, BR-015, BR-042
- Type: State / Negative
- Priority: High
- Preconditions: Đơn TAILORING.
- Test data: status đích SHIPPING; expectedStatus lệch.

| # | Action | Expected result |
|---|---|---|
| 1 | Admin đặt SHIPPING | 400 “Trạng thái này phải do thanh toán hoặc vận chuyển đã xác minh cập nhật.” |
| 2 | Admin đặt READY_TO_SHIP với `expectedStatus` sai | 409 “Đơn hàng đã được cập nhật bởi thao tác khác…” |
| 3 | Admin đặt đúng trạng thái hiện tại | No-op, trả đơn, không thêm event |
| 4 | User thường gọi endpoint | 403 |

- Expected result: Map trạng thái và quyền admin được giữ.
- Automation candidate: Yes
- Status: Not Run

### TC-009 — Thiếu số đo bắt buộc

- Related: US-002 / BR-003
- Type: Validation
- Priority: Critical
- Preconditions: Hồ sơ thiếu `waist`; đơn có quần.
- Test data: measurement null một trường.

| # | Action | Expected result |
|---|---|---|
| 1 | Tạo đơn | 400 `MEASUREMENTS_INCOMPLETE`, `missing` có nhãn “Vòng eo” |
| 2 | Bổ sung số đo rồi tạo lại | 200 |
| 3 | Đơn chỉ có áo | Không đòi trường của quần |

- Expected result: Chỉ chặn đúng trường cần cho `garmentType`.
- Automation candidate: Yes
- Status: Not Run

### TC-010 — Cổng duyệt số đo

- Related: US-004 / BR-024
- Type: State
- Priority: High
- Preconditions: Đơn MEASUREMENT_REVIEW có 1 review OPEN.
- Test data: review OPEN, review SUBMITTED.

| # | Action | Expected result |
|---|---|---|
| 1 | Admin chuyển MEASUREMENT_CONFIRMED khi còn OPEN | 400 |
| 2 | Khách gửi lại số đo (review SUBMITTED) rồi admin confirm | 200, review resolved |
| 3 | Admin hủy đơn khi đang review | Review đóng, đơn CANCELLED |

- Expected result: Không may khi còn yêu cầu số đo mở.
- Automation candidate: Yes
- Status: Not Run

## TS-003 — Thanh toán

### TC-011 — Sai số tiền và cổng báo thất bại

- Related: US-003 / BR-019
- Type: Negative / Integration
- Priority: Critical
- Preconditions: Payment PENDING cho đơn 500.000.
- Test data: callback SUCCESS amount 499.000; callback FAILED amount 0; `requestId` sai.

| # | Action | Expected result |
|---|---|---|
| 1 | Callback SUCCESS sai tiền | Payment `REFUND_REQUIRED`, `WebhookFailure AMOUNT_MISMATCH`, không PAID |
| 2 | Callback thất bại amount 0 | Payment FAILED, **không** báo lệch số tiền |
| 3 | Callback sai `requestId` | `REFUND_REQUIRED`, `REQUEST_ID_MISMATCH` |

- Expected result: Không ghi nhận thanh toán sai; khoản đã thu vào diện hoàn.
- Automation candidate: Yes
- Status: PASS (EXEC-004)

### TC-012 — Khoá chống trùng giao dịch

- Related: US-003 / BR-020
- Type: Consistency
- Priority: Critical
- Preconditions: Hai đơn cùng ghi chú chuyển khoản; một giao dịch cổng.
- Test data: reference trùng; transId trùng.

| # | Action | Expected result |
|---|---|---|
| 1 | Xác nhận tay hai đơn cùng ghi chú | Không đụng khoá chống trùng của nhau |
| 2 | Cùng `transId` cho hai đơn qua cổng | Chỉ một payment được ghi; lần hai bị chặn |
| 3 | IPN và bank webhook cùng về | Chỉ một lần claim PAID |

- Expected result: Một khoản tiền không ghi cho hai đơn, không xử lý hai lần.
- Automation candidate: Yes
- Status: PASS (EXEC-005)

### TC-013 — Tạo link thanh toán sai đối tượng/trạng thái

- Related: US-003 / BR-016
- Type: Auth / Negative
- Priority: High
- Preconditions: Đơn của B, đơn đã PAID, đơn CANCELLED.
- Test data: 3 orderId.

| # | Action | Expected result |
|---|---|---|
| 1 | A checkout đơn của B | 404 |
| 2 | Checkout đơn đã PAID | 400 “Đơn hàng này đã được thanh toán.” |
| 3 | Checkout đơn CANCELLED | 400 “Không thể thanh toán đơn hàng ở trạng thái CANCELLED.” |
| 4 | Đơn thiếu GHN ward | 400 “Đơn hàng thiếu địa chỉ giao hàng hợp lệ…” |

- Expected result: Không tạo link cho đơn không hợp lệ.
- Automation candidate: Yes
- Status: Not Run

### TC-014 — ZaloPay callback sai MAC/app_id

- Related: US-003 / BR-017
- Type: Security
- Priority: Critical
- Preconditions: Có `ZALOPAY_KEY2`, `ZALOPAY_APP_ID`.
- Test data: mac sai; app_id khác; data không phải JSON.

| # | Action | Expected result |
|---|---|---|
| 1 | Callback mac sai | Không tạo payment PAID; ack retry |
| 2 | Callback app_id khác | Từ chối |
| 3 | Callback hợp lệ | PAID + `zp_trans_id` lưu `transactionId` |

- Expected result: Chỉ callback ký đúng mới đổi trạng thái.
- Automation candidate: Yes
- Status: Not Run

### TC-015 — SePay fail-closed ở production

- Related: US-003 / BR-018
- Type: Security
- Priority: Critical
- Preconditions: `NODE_ENV=production`, thiếu `SEPAY_IPN_SECRET`.
- Test data: IPN không chữ ký; timestamp lệch 10 phút.

| # | Action | Expected result |
|---|---|---|
| 1 | IPN thiếu secret cấu hình | 400, không xử lý |
| 2 | Timestamp lệch > 300s | 400 |
| 3 | Development thiếu secret | Bỏ qua kiểm tra + log warning |
| 4 | IPN có `x-secret-key` đúng | Được chấp nhận (đường shared secret) |

- Expected result: Production không nhận webhook không xác thực.
- Automation candidate: Yes
- Status: Not Run

### TC-016 — Sau PAID: đơn sang duyệt số đo, giỏ được dọn

- Related: US-001, US-003 / AC-003, AC-011 / BR-021, BR-022, BR-023
- Type: Integration
- Priority: Critical
- Preconditions: Đơn CREATED+PENDING có 2 dòng trong giỏ; outbox bật.
- Test data: callback hợp lệ.

| # | Action | Expected result |
|---|---|---|
| 1 | Xử lý callback | Order MEASUREMENT_REVIEW, paymentStatus PAID, `amountPaidVnd = amount` |
| 2 | Kiểm tra giỏ | Hai dòng đã mua bị xoá |
| 3 | Kiểm tra outbox | Đúng 1 event `PAYMENT_POST_SUCCESS`, jobId không chứa `:` |
| 4 | Gửi lại callback | Không xoá giỏ lần hai, không enqueue lần hai |

- Expected result: Side effect đúng một lần, lỗi queue không làm fail webhook.
- Automation candidate: Yes
- Status: Not Run

### TC-017 — Outbox jobId an toàn

- Related: US-003 / BR-022
- Type: Regression
- Priority: Medium
- Preconditions: Tạo outbox event trong và ngoài transaction.
- Test data: event id có UUID.

| # | Action | Expected result |
|---|---|---|
| 1 | `enqueueEvent` | `jobId` = event id, không chứa `:` |
| 2 | `createEvent` trong transaction | Cùng quy tắc |

- Expected result: Job không bị BullMQ từ chối vì ký tự `:`.
- Automation candidate: Yes
- Status: PASS (EXEC-006)

## TS-004 — Vận chuyển

### TC-018 — Giá trị khai báo bảo hiểm GHN

- Related: US-008 / BR-025
- Type: Calculation
- Priority: High
- Preconditions: Đơn 2 món, có coupon và phí ship.
- Test data: 500.000×1 + 300.000×2; ship 40.000; giảm 100.000.

| # | Action | Expected result |
|---|---|---|
| 1 | Tạo vận đơn từ admin | `insurance_value = 1.100.000` (không gồm ship/giảm) |
| 2 | So với lúc quote | Cùng giá trị |
| 3 | Luồng outbox (nếu bật) | Cùng giá trị |

- Expected result: Bảo hiểm = tiền hàng, không phải tổng thanh toán.
- Automation candidate: Yes
- Status: PASS (EXEC-007)

### TC-019 — Hủy vận đơn sau khi hãng lấy hàng

- Related: US-008 / BR-026
- Type: State / Negative
- Priority: High
- Preconditions: Vận đơn ở các trạng thái PICKED/SHIPPING/DELIVERING/RETURNING/READY_TO_PICK/PICKING.
- Test data: 6 vận đơn.

| # | Action | Expected result |
|---|---|---|
| 1 | Hủy vận đơn PICKED/SHIPPING/DELIVERING/RETURNING | 400, không gọi GHN |
| 2 | Hủy READY_TO_PICK/PICKING | Gọi GHN, Shipment CANCELLED |
| 3 | Kiểm tra `canCancel` trên UI list | Chỉ bật trước khi lấy hàng |
| 4 | Gọi endpoint hủy theo đơn | Cùng luật chặn |

- Expected result: Không hủy được vận đơn đã rời shop.
- Automation candidate: Yes
- Status: PASS (EXEC-008)

### TC-020 — GHN webhook secret

- Related: US-005 / BR-027
- Type: Security
- Priority: Critical
- Preconditions: `GHN_WEBHOOK_SECRET` được đặt / không đặt.
- Test data: header đúng/sai, query `?secret=`, secret không phải chuỗi.

| # | Action | Expected result |
|---|---|---|
| 1 | Secret qua header | Chấp nhận |
| 2 | Secret qua query | Chấp nhận |
| 3 | Thiếu/sai secret | 401 “Invalid GHN webhook secret” |
| 4 | Chưa cấu hình secret | Bỏ kiểm tra |

- Expected result: Chỉ request đúng secret mới được xử lý khi secret được cấu hình.
- Automation candidate: Yes
- Status: PASS (EXEC-009)

### TC-021 — Webhook GHN lặp/cũ

- Related: US-005 / BR-027
- Type: Consistency / Boundary
- Priority: High
- Preconditions: Vận đơn đã có trạng thái mới hơn.
- Test data: event cùng key; event cũ hơn `providerEventAt`.

| # | Action | Expected result |
|---|---|---|
| 1 | Gửi lại cùng eventKey | `{ignored:true}`, không thêm lịch sử |
| 2 | Gửi event cũ hơn | Bị đánh dấu stale, không lùi trạng thái |
| 3 | Gửi event không có timestamp | Không ghi đè trạng thái đã có mốc |
| 4 | Một vận đơn lỗi trong batch sync | Các vận đơn khác vẫn sync |

- Expected result: Trạng thái không lùi, không nhân đôi event.
- Automation candidate: Yes
- Status: PASS (EXEC-010)

### TC-022 — Ánh xạ trạng thái vận chuyển sang đơn

- Related: US-005 / BR-028
- Type: State
- Priority: High
- Preconditions: Đơn READY_TO_SHIP/SHIPPING/DELIVERED/CANCELLED.
- Test data: các cặp (order status, shipment status).

| # | Action | Expected result |
|---|---|---|
| 1 | READY_TO_SHIP + PICKED/DELIVERING | Đơn SHIPPING |
| 2 | READY_TO_SHIP/SHIPPING + DELIVERED | Đơn DELIVERED + history + thông báo |
| 3 | SHIPPING + DELIVERY_FAILED/RETURNING | Đơn giữ nguyên |
| 4 | COMPLETED/CANCELLED + DELIVERED | Đơn giữ nguyên |
| 5 | Đơn vừa đổi ở nơi khác | Không ghi đè, không báo |

- Expected result: Chỉ tiến trạng thái, đúng bảng ánh xạ.
- Automation candidate: Yes
- Status: PASS (EXEC-011)

### TC-023 — Xác nhận nhận hàng khi chưa giao

- Related: US-005 / BR-029
- Type: Negative / State
- Priority: High
- Preconditions: Đơn SHIPPING chưa có mốc delivered; đơn DELIVERED.
- Test data: shipment `delivering`, `delivered`.

| # | Action | Expected result |
|---|---|---|
| 1 | Confirm khi hãng chưa báo giao | 400 “Chỉ có thể xác nhận khi đơn vị vận chuyển đã giao hàng.” |
| 2 | Confirm khi DELIVERED | COMPLETED + event |
| 3 | Confirm đơn của người khác | 404 |

- Expected result: Không tự đóng đơn trước khi hàng tới.
- Automation candidate: Yes
- Status: Not Run

### TC-024 — Cửa sổ báo chưa nhận hàng

- Related: US-005 / BR-030
- Type: Boundary
- Priority: High
- Preconditions: Vận đơn delivered 6 ngày và 8 ngày trước.
- Test data: 2 đơn.

| # | Action | Expected result |
|---|---|---|
| 1 | Báo chưa nhận trong 7 ngày | DELIVERY_DISPUTED + evidence + thông báo admin |
| 2 | Báo sau 7 ngày | 400 “Đã quá 7 ngày…” |
| 3 | Báo lần hai khi dispute mở | 400 “Đơn hàng đã có báo cáo chưa nhận…” |

- Expected result: Chỉ một dispute trong cửa sổ.
- Automation candidate: Yes
- Status: Not Run

## TS-005 — Đổi trả và hoàn tiền

### TC-025 — Điều kiện mở issue

- Related: US-006 / BR-031
- Type: Boundary / State
- Priority: Critical
- Preconditions: Đơn COMPLETED 6 ngày, 8 ngày; đơn SHIPPING.
- Test data: 3 đơn.

| # | Action | Expected result |
|---|---|---|
| 1 | Tạo issue trong 7 ngày | 201, issue PENDING, đơn RETURN_REQUESTED |
| 2 | Tạo issue sau 7 ngày | 400 “Đã quá 7 ngày…” |
| 3 | Tạo issue khi đơn SHIPPING | 400 “Chỉ có thể báo lỗi khi đơn hàng đã hoàn tất…” |
| 4 | Báo chưa nhận tiền hoàn khi refund chưa COMPLETED | 400 |

- Expected result: Chỉ nhận yêu cầu đúng cửa sổ/trạng thái.
- Automation candidate: Yes
- Status: Not Run

### TC-026 — Bằng chứng và một yêu cầu mỗi item

- Related: US-006 / BR-032
- Type: Validation / Negative
- Priority: High
- Preconditions: Đơn có 2 item.
- Test data: 0 ảnh; STK 5 số; item đã có issue RESOLVED.

| # | Action | Expected result |
|---|---|---|
| 1 | Submit không ảnh | 400 “Vui lòng đính kèm ít nhất 1 ảnh…” |
| 2 | STK “12345” | 400 “Số tài khoản phải gồm 6-20 chữ số” |
| 3 | Item đã RESOLVED | 400 “Sản phẩm này đã được xử lý hoàn tiền, không thể báo lỗi lại” |
| 4 | Item còn lại | Vẫn tạo được issue mới |

- Expected result: Mỗi item tối đa một issue active.
- Automation candidate: Yes
- Status: Not Run

### TC-027 — Tiền hàng hoàn trừ giảm giá theo tỷ lệ

- Related: US-007 / BR-033
- Type: Calculation / Boundary
- Priority: Critical
- Preconditions: Đơn 2 món 500.000 + 500.000, giảm 100.000; đơn cũ thiếu cột `*Vnd`.
- Test data: item 500.000.

| # | Action | Expected result |
|---|---|---|
| 1 | Hoàn món 500.000 | 450.000 |
| 2 | Hoàn cả hai món | Tổng 900.000, không gộp ship |
| 3 | Đơn cũ thiếu `lineTotalVnd` | Fallback `price × quantity` và cột Decimal |

- Expected result: Tổng hoàn không vượt số thực thu sau giảm.
- Automation candidate: Yes
- Status: PASS (EXEC-012)

### TC-028 — Phí ship hoàn một lần, đúng base

- Related: US-007 / BR-034
- Type: Calculation
- Priority: High
- Preconditions: Đơn phí ship 40.000; đã có refund SHIPPING COMPLETED.
- Test data: shippingFeeVnd 40000; đơn cũ chỉ có `shippingFee`.

| # | Action | Expected result |
|---|---|---|
| 1 | Duyệt issue lỗi shop, bỏ trống `refundShipping` | Tạo refund SHIPPING 40.000 |
| 2 | Duyệt issue thứ hai | Không tạo thêm khoản SHIPPING |
| 3 | Đơn cũ | Lấy từ cột Decimal |

- Expected result: Tối đa một khoản hoàn phí ship mỗi đơn.
- Automation candidate: Yes
- Status: PASS (EXEC-013)

### TC-029 — Không chốt tay khi cổng đang hoàn tiền

- Related: US-009 / BR-035
- Type: State / Negative
- Priority: High
- Preconditions: Đơn có refund cổng `PROCESSING`/`PENDING` và một khoản MANUAL.
- Test data: 2 refund.

| # | Action | Expected result |
|---|---|---|
| 1 | Admin chốt MANUAL COMPLETED | 400 “Cổng thanh toán đang hoàn tiền…” |
| 2 | Refund cổng đã COMPLETED | Cho chốt, trừ vào hạn mức còn lại |
| 3 | Khoản `PAYMENT_ONLY` (thu trùng) | Không chặn chuyển khoản tay của đơn |

- Expected result: Không hoàn vượt quá số đã thu.
- Automation candidate: Yes
- Status: PASS (EXEC-014)

### TC-030 — Chứng từ hoàn tiền trong email

- Related: US-007 / BR-035
- Type: Positive / Security
- Priority: Medium
- Preconditions: Refund COMPLETED có ảnh chứng từ + mã giao dịch.
- Test data: 2 URL http(s), 1 URL `javascript:`.

| # | Action | Expected result |
|---|---|---|
| 1 | Render email | Có số tiền, STK, mã giao dịch, ảnh hợp lệ |
| 2 | URL không phải http(s) | Bị bỏ |
| 3 | Nội dung ngân hàng có ký tự HTML | Được escape |
| 4 | Refund qua cổng | Không hiện khối STK |

- Expected result: Email đúng dữ liệu, không XSS.
- Automation candidate: Yes
- Status: PASS (EXEC-015)

### TC-031 — Rollup `paymentStatus` sau hoàn tiền

- Related: US-007 / BR-036
- Type: Calculation
- Priority: High
- Preconditions: Đơn thu 1.000.000; hoàn lần lượt 300.000 rồi 700.000.
- Test data: 3 mốc.

| # | Action | Expected result |
|---|---|---|
| 1 | Chưa hoàn | PAID |
| 2 | Hoàn 300.000 | PARTIALLY_REFUNDED |
| 3 | Hoàn đủ/vượt | REFUNDED |
| 4 | Hoàn đủ rồi hoàn tiếp | 0 còn lại, bị chặn |

- Expected result: Trạng thái thanh toán phản ánh đúng tổng đã hoàn.
- Automation candidate: Yes
- Status: PASS (EXEC-016)

### TC-032 — Báo chưa nhận được tiền hoàn

- Related: US-007 / BR-037
- Type: Workflow
- Priority: High
- Preconditions: refundStatus COMPLETED hôm qua; một bản ghi đã 8 ngày; một báo cáo đang PENDING.
- Test data: 3 đơn.

| # | Action | Expected result |
|---|---|---|
| 1 | Tạo báo cáo trong 7 ngày | Chấp nhận; refund cũ FAILED; order refundStatus REQUIRED |
| 2 | Quá 7 ngày | 400 “Đã quá 7 ngày kể từ khi hoàn tiền…” |
| 3 | Đã có báo cáo PENDING | 400 chờ shop xử lý |
| 4 | Admin duyệt | Mở lại đúng khoản, cùng kind/số tiền |

- Expected result: Khoản hoàn được chuyển lại minh bạch.
- Automation candidate: Yes
- Status: Not Run

### TC-033 — Issue chỉ RESOLVED khi hết khoản hoàn mở

- Related: US-009 / BR-038
- Type: State
- Priority: High
- Preconditions: Đơn có 2 issue được duyệt, 2 khoản GOODS.
- Test data: 2 refund REQUIRED.

| # | Action | Expected result |
|---|---|---|
| 1 | Chốt khoản 1 | Khoản 2 vẫn REQUIRED; cả hai issue APPROVED |
| 2 | Chốt khoản 2 | Hai issue RESOLVED |
| 3 | Từ chối issue không lý do | 400 |

- Expected result: “Đã hoàn tiền” chỉ xuất hiện khi tiền đã đi.
- Automation candidate: Yes
- Status: Not Run

### TC-034 — Hoàn tiền qua cổng: hạn mức và idempotency

- Related: US-009 / BR-039
- Type: Boundary / Integration
- Priority: High
- Preconditions: Payment PAID 500.000; đã hoàn 200.000 COMPLETED.
- Test data: yêu cầu 400.000; lặp cùng `idempotencyKey`.

| # | Action | Expected result |
|---|---|---|
| 1 | Yêu cầu 400.000 | 400 vượt hạn mức còn lại (300.000) |
| 2 | Yêu cầu 300.000 | Refund PROCESSING hoặc COMPLETED |
| 3 | Gửi lại cùng key | Trả refund cũ, không gọi cổng lần hai |
| 4 | Payment SEPAY | 400, phải dùng luồng tay |

- Expected result: Không hoàn quá số thu; không gọi cổng trùng.
- Automation candidate: Yes
- Status: Not Run

### TC-035 — Xác nhận tay và gợi ý đối soát

- Related: US-010 / BR-040
- Type: Workflow
- Priority: High
- Preconditions: Giao dịch chuyển khoản 500.000 không khớp mã; 6 đơn PENDING cùng tiền.
- Test data: 6 đơn trong ±24h, 1 đơn ngoài cửa sổ.

| # | Action | Expected result |
|---|---|---|
| 1 | Mở đối soát | Tối đa 5 gợi ý đúng số tiền trong ±24h |
| 2 | Xác nhận tay kèm reference | Đơn PAID, payment MANUAL_ADMIN |
| 3 | Không chọn ứng viên | Không đổi trạng thái |

- Expected result: Admin quyết định, hệ thống không tự gán.
- Automation candidate: Yes
- Status: Not Run

### TC-036 — Sổ webhook lỗi

- Related: US-010 / BR-041
- Type: Error handling
- Priority: Medium
- Preconditions: Webhook sai chữ ký/không tìm thấy payment.
- Test data: 2 webhook lỗi.

| # | Action | Expected result |
|---|---|---|
| 1 | Xử lý webhook lỗi | `WebhookFailure` xuất hiện với code tương ứng |
| 2 | Admin resolve | Biến mất khỏi tab chưa xử lý |
| 3 | Lỗi ghi failure (DB down) | Webhook vẫn trả lỗi gốc, không crash |

- Expected result: Không mất dấu sự cố thanh toán.
- Automation candidate: Yes
- Status: Not Run

## TS-006 — UI, quyền và dữ liệu hiển thị

### TC-037 — Giỏ guest và merge

- Related: US-001 / BR-043
- Type: Positive / Boundary
- Priority: High
- Preconditions: Guest có 2 dòng; server đã có 1 dòng trùng.
- Test data: qty 1 vs 3.

| # | Action | Expected result |
|---|---|---|
| 1 | Thêm món khi chưa đăng nhập, reload | Giỏ còn trong `stale_cart` |
| 2 | Đăng nhập | Merge; dòng trùng giữ qty 3; giỏ guest bị xoá |
| 3 | Đăng xuất | Giỏ guest trống, không lộ dữ liệu người trước |
| 4 | Số lượng server 1001 | Kẹp 1000 |

- Expected result: Không mất/không lẫn giỏ giữa phiên.
- Automation candidate: Yes (Playwright)
- Status: Not Run

### TC-038 — Checkout xử lý lỗi tải địa chỉ

- Related: US-002 / BR-009
- Type: Error
- Priority: Medium
- Preconditions: `GET /users/me/addresses` trả 500.
- Test data: mock 500.

| # | Action | Expected result |
|---|---|---|
| 1 | Mở `/checkout` | Hiển thị lỗi tải sổ địa chỉ + thử lại |
| 2 | Bấm đặt hàng | Chặn submit |

- Expected result: Không hiển thị sai thành “Bạn chưa có địa chỉ”.
- Automation candidate: Yes
- Status: Not Run (hiện FAIL theo BUG-009)

### TC-039 — Phân quyền admin

- Related: US-008/009/010 / BR-042
- Type: Auth
- Priority: Critical
- Preconditions: Tài khoản customer và admin.
- Test data: 2 token.

| # | Action | Expected result |
|---|---|---|
| 1 | Customer gọi `/orders/all` | 403 |
| 2 | Customer gọi `/admin/shipments` | 403 |
| 3 | Customer gọi `/order-issues` | 403 |
| 4 | Admin gọi lại | 200 |

- Expected result: Không lộ dữ liệu vận hành cho khách.
- Automation candidate: Yes
- Status: Not Run

### TC-040 — Trang `/orders/[id]/success` phản ánh dữ liệu thật

- Related: US-003 / BR-014, BR-021
- Type: Regression
- Priority: Medium
- Preconditions: Đơn vừa tạo nhưng chưa thanh toán.
- Test data: orderId thật.

| # | Action | Expected result |
|---|---|---|
| 1 | Mở trang success | Trạng thái đúng là “Chờ thanh toán”, không phải “Đã nhận đơn” |
| 2 | Kiểm tra mã đơn | Là `orderCode` thật, không phải 8 ký tự UUID |
| 3 | Kiểm tra banner nâng cấp | Không hiển thị khi không mua gói |

- Expected result: Không hiển thị thông tin giả.
- Automation candidate: Yes
- Status: Not Run (hiện FAIL theo BUG-008)

### TC-041 — Chuyển trạng thái sau khi giao cho phép trả hàng

- Related: US-008 / BR-014
- Type: State
- Priority: High
- Preconditions: Đơn ở SHIPPING/DELIVERED/COMPLETED.
- Test data: 3 trạng thái.

| # | Action | Expected result |
|---|---|---|
| 1 | Kiểm tra map | SHIPPING/DELIVERED/COMPLETED cho phép RETURN_REQUESTED/RETURN_APPROVED |
| 2 | RETURN_APPROVED | Đi tiếp được RETURNING và RETURNED |
| 3 | RETURNED | Không có transition ra |

- Expected result: Luồng trả hàng không bị kẹt.
- Automation candidate: Yes
- Status: PASS (EXEC-017)

### TC-042 — Lọc danh sách đơn admin

- Related: US-008 / BR-042
- Type: Positive
- Priority: Medium
- Preconditions: 30 đơn khác trạng thái/ngày.
- Test data: filter status + paymentStatus + khoảng ngày.

| # | Action | Expected result |
|---|---|---|
| 1 | Lọc theo status | Chỉ đơn đúng trạng thái |
| 2 | Tìm theo mã/email | Đúng đơn |
| 3 | Xoá filter | Về mặc định, hiển thị đủ |

- Expected result: Kết quả server và client-side filter khớp nhau.
- Automation candidate: Yes
- Status: Not Run

### TC-043 — Phân nhánh trang kết quả thanh toán

- Related: US-003 / BR-019, BR-021, BR-036
- Type: Positive / Error
- Priority: Medium
- Preconditions: Payment ở các trạng thái PAID/FAILED/REFUND_REQUIRED/PENDING/REFUNDED.
- Test data: 5 payment.

| # | Action | Expected result |
|---|---|---|
| 1 | PAID | “Thanh toán thành công”, CTA về đơn |
| 2 | FAILED | “Thanh toán chưa thành công” + lý do + thanh toán lại |
| 3 | REFUND_REQUIRED | “Khoản thanh toán cần hoàn lại” |
| 4 | PENDING | “Đang xác nhận thanh toán” |
| 5 | REFUNDED | Hiển thị đã thanh toán (settled), không báo thất bại |

- Expected result: Không báo sai trạng thái tiền.
- Automation candidate: Yes
- Status: Not Run

### TC-044 — Snapshot đơn không đổi khi sản phẩm đổi sau đó

- Related: US-002 / BR-002
- Type: Consistency
- Priority: High
- Preconditions: Đơn đã tạo với sản phẩm A và số đo hiện tại.
- Test data: đổi tên/giá/ảnh sản phẩm A; sửa hồ sơ số đo.

| # | Action | Expected result |
|---|---|---|
| 1 | Mở lại đơn | Tên/ảnh/giá đúng tại thời điểm đặt |
| 2 | Xem số đo của item | Snapshot cũ, không theo hồ sơ mới |
| 3 | Sản phẩm bị ARCHIVED | Đơn cũ vẫn hiển thị bình thường |

- Expected result: Đơn cũ là bản ghi bất biến của giao dịch.
- Automation candidate: Yes
- Status: Not Run

### TC-045 — Phí ship theo địa chỉ, khối lượng và cache

- Related: US-002 / BR-008
- Type: Calculation / Integration
- Priority: High
- Preconditions: GHN sandbox + địa chỉ lấy hàng đã cấu hình.
- Test data: 1 món (500g) và 3 món (1500g), cùng địa chỉ; đổi quận.

| # | Action | Expected result |
|---|---|---|
| 1 | Quote 1 món | Phí theo weight 500g |
| 2 | Quote 3 món cùng địa chỉ | Phí theo 1500g, khác lần 1 nếu bậc giá đổi |
| 3 | Quote lặp trong 5 phút | Dùng cache, cùng số |
| 4 | Đổi phường/xã | Gọi GHN lại, phí mới |
| 5 | Thiếu cấu hình pickup | 400 `CAPABILITY_DISABLED` |

- Expected result: FE không thể tự đặt phí; phí khớp GHN.
- Automation candidate: Yes
- Status: Not Run

### TC-046 — COD bị từ chối

- Related: US-003 / BR-010
- Type: Negative
- Priority: High
- Preconditions: Sản phẩm ACTIVE, đủ số đo.
- Test data: `paymentMethod: "COD"`, `"MOMO"`.

| # | Action | Expected result |
|---|---|---|
| 1 | Tạo đơn COD | 400 “Đơn may đo mới chỉ hỗ trợ thanh toán online, không hỗ trợ COD.” |
| 2 | Tạo đơn BANK_TRANSFER | 201 |

- Expected result: Không có đơn COD.
- Automation candidate: Yes
- Status: Not Run

### TC-047 — Checkout gửi đúng provider sau khi tạo đơn

- Related: US-003 / BR-016
- Type: Positive / Integration
- Priority: High
- Preconditions: Đơn vừa tạo thành công.
- Test data: chọn ZaloPay và SePay.

| # | Action | Expected result |
|---|---|---|
| 1 | Bấm đặt hàng với ZaloPay | `POST /orders` với `paymentMethod: "BANK_TRANSFER"`, sau đó `POST /payments/checkout` `provider: "ZALOPAY"` |
| 2 | Chọn SePay | `provider: "SEPAY"` |
| 3 | Checkout lỗi sau khi đơn đã tạo | Điều hướng `/orders/:id`, không tạo đơn thứ hai |
| 4 | Double-click nút đặt hàng | Chỉ một đơn (idempotencyKey) |

- Expected result: Provider đúng lựa chọn, không nhân đôi đơn.
- Automation candidate: Yes
- Status: Not Run

### TC-048 — Chi tiết đơn hiển thị đúng dữ liệu vận hành

- Related: US-004 / BR-014
- Type: Positive
- Priority: Medium
- Preconditions: Đơn có timeline nhiều mốc và một vận đơn GHN.
- Test data: 6 event, shipment SHIPPING.

| # | Action | Expected result |
|---|---|---|
| 1 | Mở `/orders/:id` | Trạng thái + mô tả khớp `order.status` |
| 2 | Xem timeline | 5 mốc gần nhất, mở rộng được |
| 3 | Xem vận chuyển | Mã vận đơn + nhãn trạng thái thật |
| 4 | Xem tiền | Tổng, đã trả, đã hoàn khớp API |

- Expected result: Không hard-code, không lệch nhãn.
- Automation candidate: Yes
- Status: Not Run

### TC-049 — Chặn tạo vận đơn sai điều kiện

- Related: US-008 / BR-025
- Type: Negative / State
- Priority: High
- Preconditions: Đơn TAILORING đã PAID; đơn READY_TO_SHIP chưa PAID.
- Test data: 2 đơn.

| # | Action | Expected result |
|---|---|---|
| 1 | Tạo vận đơn cho TAILORING | 400 “Chỉ tạo vận đơn cho đơn may đo READY_TO_SHIP đã thanh toán.” |
| 2 | Tạo vận đơn cho READY_TO_SHIP chưa PAID | 400 cùng thông điệp |
| 3 | Đơn thiếu GHN ward | 400 `ADDRESS_RECONFIRM_REQUIRED` |
| 4 | Gọi lặp với cùng `requestKey` | Không tạo vận đơn thứ hai |

- Expected result: Chỉ một vận đơn hợp lệ cho mỗi đơn.
- Automation candidate: Yes
- Status: Not Run

### TC-050 — “Duyệt và hoàn tiền luôn” cần chứng từ

- Related: US-009 / BR-035
- Type: Negative
- Priority: High
- Preconditions: Issue PENDING, đơn COMPLETED.
- Test data: `refundNow=true`, thiếu ảnh; thiếu mã GD; đủ cả hai.

| # | Action | Expected result |
|---|---|---|
| 1 | Duyệt hoàn ngay thiếu ảnh | 400 “Hoàn tiền ngay cần mã giao dịch và ảnh chứng từ chuyển khoản.” |
| 2 | Thiếu `evidenceReference` | 400 cùng thông điệp |
| 3 | Đủ ảnh + mã | Issue APPROVED→RESOLVED, đơn RETURNED, refund COMPLETED |
| 4 | Đơn chưa thu tiền | 400 “Đơn hàng chưa ghi nhận tiền thanh toán…” |

- Expected result: Không chi tiền mà thiếu chứng từ.
- Automation candidate: Yes
- Status: Not Run
