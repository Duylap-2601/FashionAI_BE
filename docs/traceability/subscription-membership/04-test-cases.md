# Test cases — FLW-005 (subscription)

`Status` chỉ `PASS` khi có `EXEC` tương ứng trong `05-execution.md`. Bằng chứng thật là Jest unit/e2e BE (mock Prisma/Redis/provider) và `node:test` FE; không có ZaloPay/SePay/Postgres/Redis hay browser thật.

Tham chiếu `TC-###` trong `01-user-stories.md` được giữ nguyên số — file này là nguồn định nghĩa của chúng.

## TS-029 — Giá, gói, checkout

### TC-178 — Plans public
- **Related:** US-035 / AC-109 / BR-156, BR-157 / SCR-030
- **Type:** Positive · **Priority:** P0
- **Preconditions:** Không cần JWT.
- **Test data:** `GET /payments/plans`.
| # | Action | Expected result |
|---|---|---|
| 1 | Gọi plans không token | 200, 3 gói FREE/MEMBER/VIP |
| 2 | Kiểm tra field | `durationDays` 0/30/30; VIP quota `null` + `unlimited=true`; giá 0/34k/99k |
- **Expected:** bảng giá đúng hằng số `TIER_PRICES`, không cần auth.
- **Automation:** Yes · **Status:** PASS (EXEC-116)

### TC-179 — `GET me` khi chưa có gói
- **Related:** US-040 / AC-127 / BR-185
- **Type:** Positive · **Priority:** P1
- **Preconditions:** User FREE, không có subscription.
| # | Action | Expected result |
|---|---|---|
| 1 | Gọi me | 200 |
| 2 | Kiểm tra | `tier=FREE`, `current=null`, `scheduled=null`, `isFree=true` |
- **Expected:** UI không vỡ khi chưa mua gói.
- **Automation:** Yes · **Status:** PASS (EXEC-117)

### TC-180 — Từ chối gói FREE
- **Related:** US-035 / AC-111 / BR-159
- **Type:** Negative · **Priority:** P0
- **Preconditions:** JWT hợp lệ.
| # | Action | Expected result |
|---|---|---|
| 1 | `POST /checkout {targetTier:'FREE'}` | 400 |
| 2 | Kiểm tra DB | Không tạo order |
- **Expected:** không có đơn rác; hướng dẫn dùng cancel/không mua.
- **Automation:** Yes · **Status:** PASS (EXEC-118)

### TC-181 — MoMo bị chặn cho đơn gói
- **Related:** US-035 / AC-112 / BR-160, BR-162
- **Type:** Validation · **Priority:** P0
- **Preconditions:** JWT.
| # | Action | Expected result |
|---|---|---|
| 1 | `{targetTier:'MEMBER', provider:'MOMO'}` | 400 |
| 2 | Kiểm tra DB | Không tạo order |
| 3 | Đơn sản phẩm + MoMo | Vẫn được phép |
- **Expected:** kiểm tra provider chạy trước khi tạo order.
- **Automation:** Yes · **Status:** PASS (EXEC-119)

### TC-182 — Checkout tạo order PENDING đúng giá
- **Related:** US-035 / AC-110 / BR-161, BR-164, BR-165
- **Type:** Positive · **Priority:** P0
- **Preconditions:** User FREE, provider ZaloPay/SePay.
| # | Action | Expected result |
|---|---|---|
| 1 | Checkout MEMBER | 200 `checkoutUrl`, `paymentId`, `orderCode`, `kind='SUBSCRIPTION'` |
| 2 | Kiểm tra order | `targetTier=MEMBER`, `amount=34000`, `status=CREATED`, `paymentStatus=PENDING`, `checkoutExpiresAt≈now+24h` |
- **Expected:** giá lấy server-side, không nhận từ client.
- **Automation:** Yes · **Status:** PASS (EXEC-120)

### TC-183 — 409 khi đã có lịch hẹn; 400 khi body sai
- **Related:** US-038 / AC-113, AC-123 / BR-163
- **Type:** Negative / Boundary · **Priority:** P0
- **Preconditions:** User có SCHEDULED; và các body sai.
| # | Action | Expected result |
|---|---|---|
| 1 | Checkout khi có SCHEDULED | 409 kèm tier/ngày bắt đầu |
| 2 | Body rỗng | 400 |
| 3 | `orderId` không phải UUID | 400 |
| 4 | Provider lạ | 400 |
- **Expected:** FE mở modal huỷ lịch; không tạo order nào.
- **Automation:** Yes · **Status:** PASS (EXEC-121)

### TC-184 — Gia hạn khi đang ở đúng gói
- **Related:** US-036 / AC-117 / BR-169
- **Type:** Positive · **Priority:** P0
- **Preconditions:** ACTIVE MEMBER còn hạn.
| # | Action | Expected result |
|---|---|---|
| 1 | Checkout MEMBER lần nữa | 200, tạo order PENDING (không 409) |
- **Expected:** được phép mua thêm cùng tier.
- **Automation:** Yes · **Status:** PASS (EXEC-122)

## TS-030 — Proration & chuyển gói

### TC-185 — Proration MEMBER→VIP còn 15 ngày
- **Related:** US-037 / AC-119 / BR-158
- **Type:** Calculation · **Priority:** P0
- **Preconditions:** MEMBER còn 15 ngày.
| # | Action | Expected result |
|---|---|---|
| 1 | `calcUpgradeProration('MEMBER','VIP',15)` | credit 17.000, debit 50.000, net 33.000 |
| 2 | Response checkout | `kind='SUBSCRIPTION'` + `proration` breakdown |
- **Expected:** làm tròn lên 1.000đ; net không âm.
- **Automation:** Yes · **Status:** PASS (EXEC-123)

### TC-186 — Sát hạn thì thu full giá
- **Related:** US-037 / AC-120 / BR-158
- **Type:** Boundary · **Priority:** P1
- **Preconditions:** MEMBER còn ≤1 ngày.
| # | Action | Expected result |
|---|---|---|
| 1 | Checkout VIP | `amount=99000` (full), không proration |
- **Expected:** `PRORATION_MIN_REMAINING_DAYS=1`.
- **Automation:** Yes · **Status:** PASS (EXEC-124)

### TC-187 — Proration full 30 ngày bằng chênh lệch giá
- **Related:** US-037 / AC-119 / BR-158
- **Type:** Calculation · **Priority:** P2
- **Preconditions:** Còn đủ 30 ngày.
| # | Action | Expected result |
|---|---|---|
| 1 | `calcUpgradeProration(...,30)` | net = 99.000 − 34.000 = 65.000 |
- **Expected:** net không bao giờ âm kể cả downgrade.
- **Automation:** Yes · **Status:** PASS (EXEC-125)

## TS-031 — Xác nhận thanh toán & cấp quyền

### TC-188 — Webhook đơn sản phẩm không đổi tier
- **Related:** US-035 / BR-166, BR-175 / SCR-031
- **Type:** Integration · **Priority:** P0
- **Preconditions:** Order sản phẩm PENDING, webhook hợp lệ.
| # | Action | Expected result |
|---|---|---|
| 1 | Gửi callback | Order PAID, chuyển PROCESSING |
| 2 | Kiểm tra `User.tier` | Không đổi |
- **Expected:** chỉ đơn gói mới cấp tier.
- **Automation:** Yes · **Status:** PASS (EXEC-126)

### TC-189 — Webhook đơn gói nâng tier khi quote hợp lệ
- **Related:** US-035, US-037 / AC-115, AC-121 / BR-168, BR-170, BR-175
- **Type:** Integration · **Priority:** P0
- **Preconditions:** Order MEMBER PENDING có `prorationSnapshot` hợp lệ.
| # | Action | Expected result |
|---|---|---|
| 1 | Callback hợp lệ | Order PAID; subscription ACTIVE; `User.tier` khớp |
| 2 | Kiểm tra hạn | Giữ `expiresAt` của chu kỳ đã trả khi quote còn hiệu lực |
- **Expected:** cấp quyền trong cùng transaction.
- **Automation:** Yes · **Status:** PASS (EXEC-127)

### TC-190 — Quote quá 24h thì cấp theo số tiền
- **Related:** US-037 / AC-121 / BR-171
- **Type:** Boundary · **Priority:** P1
- **Preconditions:** Quote hợp lệ nhưng `Order.createdAt` > 24h.
| # | Action | Expected result |
|---|---|---|
| 1 | Callback | `grantedDays=round(paid/planPrice*30)`, kẹp 1..30 |
- **Expected:** không tặng 30 ngày khi trả thiếu; `paid<=0` → 1 ngày.
- **Automation:** Yes · **Status:** PASS (EXEC-128)

### TC-191 — Quote trỏ gói khác bị coi là cũ
- **Related:** US-037 / AC-121 / BR-171
- **Type:** Negative · **Priority:** P2
- **Preconditions:** `oldTier` trong snapshot ≠ tier hiện tại.
| # | Action | Expected result |
|---|---|---|
| 1 | Callback | Cấp theo số tiền, không theo quote |
- **Expected:** quote không dùng chéo gói.
- **Automation:** Yes · **Status:** PASS (EXEC-129)

### TC-192 — Trả thiếu tiền không được 30 ngày
- **Related:** US-037 / AC-121 / BR-171
- **Type:** Boundary · **Priority:** P1
- **Preconditions:** `paid = 50%` giá gói.
| # | Action | Expected result |
|---|---|---|
| 1 | Callback | `grantedDays≈15` |
- **Expected:** trả đủ giá → đúng 30 ngày.
- **Automation:** Yes · **Status:** PASS (EXEC-130)

### TC-193 — RENEWAL cộng 30 ngày, giữ orderId gốc
- **Related:** US-036 / AC-117, AC-118 / BR-169, BR-173
- **Type:** Positive · **Priority:** P0
- **Preconditions:** ACTIVE cùng tier còn hạn.
| # | Action | Expected result |
|---|---|---|
| 1 | Callback | `expiresAt = hạn cũ + 30 ngày` |
| 2 | Dòng ACTIVE | Vẫn giữ `orderId` gốc |
| 3 | Dòng mới | `RENEWED` mang đơn mới; không có ACTIVE thứ hai |
- **Expected:** không mất ngày, một ACTIVE/user.
- **Automation:** Yes · **Status:** PASS (EXEC-131)

### TC-194 — ACTIVE cũ hết hạn thì đóng trước khi tạo mới
- **Related:** US-035 / AC-115 / BR-168, BR-173
- **Type:** State · **Priority:** P1
- **Preconditions:** ACTIVE đã quá `expiresAt`.
| # | Action | Expected result |
|---|---|---|
| 1 | NEW mode | Đóng dòng hết hạn, tạo ACTIVE mới |
- **Expected:** luôn đúng một ACTIVE.
- **Automation:** Yes · **Status:** PASS (EXEC-132)

### TC-195 — Sai số tiền bị từ chối
- **Related:** US-035 / AC-115 / BR-166
- **Type:** Negative · **Priority:** P0
- **Preconditions:** Amount callback < order.amount.
| # | Action | Expected result |
|---|---|---|
| 1 | Callback | Từ chối; không đổi tier; ghi webhook failure |
- **Expected:** không cấp quyền miễn phí.
- **Automation:** Yes · **Status:** PASS (EXEC-133)

### TC-196 — Chữ ký sai bị từ chối
- **Related:** US-035 / AC-115 / BR-166
- **Type:** Auth / Integration · **Priority:** P0
- **Preconditions:** Signature/MAC không hợp lệ.
| # | Action | Expected result |
|---|---|---|
| 1 | Callback (SePay/ZaloPay) | Từ chối; không đổi trạng thái |
- **Expected:** webhook public nhưng phải xác thực.
- **Automation:** Yes · **Status:** PASS (EXEC-134)

### TC-197 — Callback hợp lệ cấp tier + thông báo
- **Related:** US-035 / AC-115 / BR-177
- **Type:** Integration · **Priority:** P0
- **Preconditions:** Order gói PENDING.
| # | Action | Expected result |
|---|---|---|
| 1 | Callback | PAID; notification title/message theo mode |
| 2 | Lỗi realtime | Không làm fail webhook |
- **Expected:** thông báo sau commit.
- **Automation:** Yes · **Status:** PASS (EXEC-135)

### TC-198 — Đơn đã huỷ không được cấp quyền
- **Related:** US-035 / AC-115 / BR-166
- **Type:** Negative · **Priority:** P1
- **Preconditions:** Order `CANCELLED`.
| # | Action | Expected result |
|---|---|---|
| 1 | Callback | Không claim PAID; không đổi tier |
- **Expected:** trạng thái cuối là bất biến.
- **Automation:** Yes · **Status:** PASS (EXEC-136)

### TC-199 — Callback trùng idempotent
- **Related:** US-035 / AC-116 / BR-167, BR-176
- **Type:** Integration · **Priority:** P0
- **Preconditions:** Webhook gửi 2 lần.
| # | Action | Expected result |
|---|---|---|
| 1 | Lần 1 | Claim PAID, cấp gói |
| 2 | Lần 2 | Trả "already processed"; không tạo payment/gói lần hai |
- **Expected:** unique `(provider, transactionId)` + claim điều kiện.
- **Automation:** Yes · **Status:** PASS (EXEC-137)

### TC-200 — HUỶ TRANSACTION_VOID trả lại coupon
- **Related:** US-035 / BR-166, BR-175
- **Type:** Integration · **Priority:** P2
- **Preconditions:** Đơn PENDING có coupon.
| # | Action | Expected result |
|---|---|---|
| 1 | Webhook VOID | Đơn CANCELLED; lượt coupon được trả |
- **Expected:** không cấp gói.
- **Automation:** Yes · **Status:** PASS (EXEC-138)

## TS-032 — Hẹn hạ gói & quản lý nhắc

### TC-201 — Huỷ lịch hẹn, bật lại autoRenew
- **Related:** US-039 / AC-126 / BR-189
- **Type:** Positive · **Priority:** P1
- **Preconditions:** Có SCHEDULED + ACTIVE.
| # | Action | Expected result |
|---|---|---|
| 1 | POST scheduled/cancel | SCHEDULED=CANCELLED; ACTIVE autoRenew=true |
| 2 | Kiểm tra | Không hoàn tiền; thông báo |
| 3 | Không có lịch | 404 |
- **Expected:** gói hiện tại tiếp tục đến hết hạn.
- **Automation:** Yes · **Status:** PASS (EXEC-139)

### TC-202 — GET me trả tier hiệu lực
- **Related:** US-040 / AC-127 / BR-185
- **Type:** Positive · **Priority:** P1
- **Preconditions:** Có ACTIVE/SCHEDULED.
| # | Action | Expected result |
|---|---|---|
| 1 | GET me | `tier`, `tierExpiresAt`, `current`, `scheduled`, `isFree`, `daysRemaining` |
| 2 | Tier đã hết hạn | `tier=FREE` |
| 3 | User không tồn tại | 404 |
- **Expected:** UI hiển thị đúng quyền lợi còn hiệu lực.
- **Automation:** Yes · **Status:** PASS (EXEC-140)

### TC-203 — Lịch sử phân trang
- **Related:** US-040 / AC-128 / BR-186
- **Type:** Boundary · **Priority:** P1
- **Preconditions:** Nhiều giao dịch.
| # | Action | Expected result |
|---|---|---|
| 1 | page=1 limit=20 | Mới nhất trước; meta `{total,page,limit,totalPages}` |
| 2 | limit=1000 | 400 từ DTO (`@Max(100)`) |
| 3 | page=0 | 400 từ DTO (`@Min(1)`) |
- **Expected:** tham số validate ở DTO nên không 500 (BUG-059 không tái hiện).
- **Automation:** Yes · **Status:** PASS (EXEC-141)

### TC-204 — Tắt nhắc có điều kiện
- **Related:** US-039 / AC-124 / BR-187
- **Type:** State · **Priority:** P1
- **Preconditions:** ACTIVE autoRenew=true.
| # | Action | Expected result |
|---|---|---|
| 1 | POST cancel | `autoRenew=false`, `accessUntil=expiresAt`, thông báo |
| 2 | Gọi lại | 400 "đã tắt" |
| 3 | Không có gói | 404 |
- **Expected:** quyền lợi không đổi.
- **Automation:** Yes · **Status:** PASS (EXEC-142)

### TC-205 — Bật nhắc có điều kiện
- **Related:** US-039 / AC-125 / BR-188
- **Type:** State · **Priority:** P1
- **Preconditions:** ACTIVE autoRenew=false.
| # | Action | Expected result |
|---|---|---|
| 1 | POST resume | `autoRenew=true`, thông báo nhắc 3 ngày |
| 2 | Gọi lại | 400 "đang bật" |
| 3 | Không có gói | 404 |
- **Expected:** không gia hạn, không trừ tiền.
- **Automation:** Yes · **Status:** PASS (EXEC-143)

## TS-033 — Hoàn tiền thu hồi quyền lợi

### TC-206 — Hoàn toàn bộ đơn gói hạ FREE
- **Related:** US-041 / AC-129 / BR-180
- **Type:** State · **Priority:** P0
- **Preconditions:** Đơn gói ACTIVE; refund = amountPaid.
| # | Action | Expected result |
|---|---|---|
| 1 | Refund COMPLETED | Huỷ gói; `User.tier=FREE`; thông báo |
- **Expected:** quyền lợi và refund khớp.
- **Automation:** Yes · **Status:** PASS (EXEC-144)

### TC-207 — Hoàn một phần không thu hồi
- **Related:** US-041 / AC-130 / BR-181
- **Type:** Boundary · **Priority:** P0
- **Preconditions:** refund < amountPaid.
| # | Action | Expected result |
|---|---|---|
| 1 | Refund một phần | Không đổi gói |
- **Expected:** giữ tier/hạn.
- **Automation:** Yes · **Status:** PASS (EXEC-145)

### TC-208 — Đơn sản phẩm không chạm bảng gói
- **Related:** US-041 / AC-129 / BR-180
- **Type:** Negative · **Priority:** P1
- **Preconditions:** Order không có `targetTier`.
| # | Action | Expected result |
|---|---|---|
| 1 | Refund | Bỏ qua hoàn toàn |
- **Expected:** không huỷ subscription nào.
- **Automation:** Yes · **Status:** PASS (EXEC-146)

### TC-209 — Hoàn đơn gia hạn lùi 30 ngày
- **Related:** US-041 / AC-131 / BR-182
- **Type:** Calculation · **Priority:** P0
- **Preconditions:** ACTIVE + dòng RENEWED.
| # | Action | Expected result |
|---|---|---|
| 1 | Refund đơn RENEWED | `expiresAt` ACTIVE lùi về `startsAt` của RENEWED |
- **Expected:** chỉ mất 30 ngày vừa mua, gói gốc còn.
- **Automation:** Yes · **Status:** PASS (EXEC-147)

### TC-210 — Hoàn đơn nâng cấp khôi phục gói cũ
- **Related:** US-041 / AC-131 / BR-183
- **Type:** State · **Priority:** P0
- **Preconditions:** Đơn UPGRADE; dòng MEMBER cũ còn hạn.
| # | Action | Expected result |
|---|---|---|
| 1 | Refund | Kích hoạt lại MEMBER thay vì FREE |
- **Expected:** gói cũ đã hết hạn thì mới về FREE.
- **Automation:** Yes · **Status:** PASS (EXEC-148)

### TC-211 — Payment thu trùng không cắt gói
- **Related:** US-041 / AC-131 / BR-180
- **Type:** Negative · **Priority:** P1
- **Preconditions:** `refundScope=PAYMENT_ONLY`, đơn là đơn gói.
| # | Action | Expected result |
|---|---|---|
| 1 | Refund | Không thu hồi gói |
- **Expected:** hoàn khoản thu trùng không phải hoàn gói.
- **Automation:** Yes · **Status:** PASS (EXEC-149)

### TC-212 — `finalizeGatewayRefund` hạ tier trong cùng luồng
- **Related:** US-041 / AC-129 / BR-180
- **Type:** Integration · **Priority:** P1
- **Preconditions:** Admin chốt refund cổng.
| # | Action | Expected result |
|---|---|---|
| 1 | Finalize full | Hạ tier + báo khách |
| 2 | Finalize một phần | Không đụng gói |
- **Expected:** thu hồi đồng bộ với refund.
- **Automation:** Yes · **Status:** PASS (EXEC-150)

### TC-213 — Refund sản phẩm qua finalize không chạm gói
- **Related:** US-041 / AC-130 / BR-181
- **Type:** Negative · **Priority:** P2
- **Preconditions:** Đơn sản phẩm.
| # | Action | Expected result |
|---|---|---|
| 1 | finalizeGatewayRefund | Không update subscriptions |
- **Expected:** tách bảng.
- **Automation:** Yes · **Status:** PASS (EXEC-151)

### TC-214 — `refundGatewayPayment` SUCCESS cũng thu hồi
- **Related:** US-041 / AC-131 / BR-180, BR-184
- **Type:** Integration · **Priority:** P1
- **Preconditions:** Refund qua cổng thành công ngay.
| # | Action | Expected result |
|---|---|---|
| 1 | Refund SUCCESS | Đồng bộ thu hồi gói |
- **Expected:** không phụ thuộc finalize tay.
- **Automation:** Yes · **Status:** PASS (EXEC-152)

### TC-215 — Còn gói khác thì giữ gói đó
- **Related:** US-041 / AC-129 / BR-180
- **Type:** State · **Priority:** P1
- **Preconditions:** Refund một đơn trong hai gói ACTIVE.
| # | Action | Expected result |
|---|---|---|
| 1 | Refund | Giữ gói ACTIVE còn lại, không hạ FREE |
- **Expected:** chọn đúng quyền lợi còn lại.
- **Automation:** Yes · **Status:** PASS (EXEC-153)

### TC-216 — Thu hồi idempotent
- **Related:** US-041 / AC-131 / BR-184
- **Type:** Regression · **Priority:** P1
- **Preconditions:** Finalize refund hai lần.
| # | Action | Expected result |
|---|---|---|
| 1 | Lần 2 | Trả null; không sửa state/thông báo |
- **Expected:** không hạ tiếng thêm tier.
- **Automation:** Yes · **Status:** PASS (EXEC-154)

## TS-034 — Nhắc gia hạn & sau thanh toán

### TC-217 — Cron nhắc trước 3 ngày, một lần
- **Related:** US-042 / AC-132 / BR-178
- **Type:** Workflow · **Priority:** P1
- **Preconditions:** ACTIVE autoRenew, hết hạn trong 3 ngày, chưa nhắc.
| # | Action | Expected result |
|---|---|---|
| 1 | Cron | Notification + email; `renewalReminderSentAt` set |
| 2 | Chạy lại | Không gửi lần hai |
- **Expected:** lọc đúng điều kiện `findSubscriptionsDueForRenewal`.
- **Automation:** Yes · **Status:** PASS (EXEC-155)

### TC-218 — Lock cron chống trùng instance
- **Related:** US-042 / AC-132 / BR-178
- **Type:** Integration · **Priority:** P1
- **Preconditions:** Hai instance cron đồng thời.
| # | Action | Expected result |
|---|---|---|
| 1 | Instance A giữ lock | Xử lý |
| 2 | Instance B | Bỏ qua, không nhắc trùng |
- **Expected:** `RedisService.acquireLock` + `renewalReminderSentAt`.
- **Automation:** Yes · **Status:** PASS (EXEC-156)

### TC-219 — Không nhắc khi có SCHEDULED hoặc autoRenew=false
- **Related:** US-042 / AC-132 / BR-178, BR-179
- **Type:** Negative · **Priority:** P2
- **Preconditions:** Gói có lịch hẹn; và gói đã tắt nhắc.
| # | Action | Expected result |
|---|---|---|
| 1 | Cron | Bỏ qua cả hai |
- **Expected:** nhắc chỉ cho gói sẽ tự hết hạn.
- **Automation:** Yes · **Status:** PASS (EXEC-157)

### TC-220 — Return page poll và invalidate cache
- **Related:** US-042 / AC-132 / BR-193 / SCR-031
- **Type:** Integration · **Priority:** P1
- **Preconditions:** Quay về từ cổng, webhook chưa tới.
| # | Action | Expected result |
|---|---|---|
| 1 | `/payment/success` | Poll 2 s/lần ≤20 s; PENDING không báo thất bại |
| 2 | PAID | Xoá cache subscription/quota; CTA `/subscription` |
| 3 | `paymentId` | `/payment/result` poll tương tự |
- **Expected:** không tự xác nhận thanh toán ở client.
- **Automation:** No (cần browser/timer thật) · **Status:** BLOCKED (EXEC-158)

### TC-221 — Downgrade tạo SCHEDULED, không hạ ngay
- **Related:** US-038 / AC-122 / BR-172, BR-177
- **Type:** State · **Priority:** P2
- **Preconditions:** VIP còn hạn, mua MEMBER.
| # | Action | Expected result |
|---|---|---|
| 1 | Callback DOWNGRADE | Tạo SCHEDULED `startsAt=VIP.expiresAt`, 30 ngày |
| 2 | Kiểm tra | `User.tier` vẫn VIP; ACTIVE autoRenew=false; thông báo hẹn |
- **Expected:** dùng hết kỳ VIP rồi mới hạ.
- **Automation:** Yes · **Status:** PASS (EXEC-159)

## Tổng hợp thiết kế

| TS | TC | Nhóm |
|---|---:|---|
| TS-029 | 7 | Giá, gói, checkout |
| TS-030 | 3 | Proration & chuyển gói |
| TS-031 | 13 | Xác nhận thanh toán & cấp quyền |
| TS-032 | 5 | Hẹn hạ gói & quản lý nhắc |
| TS-033 | 11 | Hoàn tiền thu hồi quyền lợi |
| TS-034 | 5 | Nhắc gia hạn & sau thanh toán |
| **Tổng** | **44** | TC-178…TC-221 |

Loại phủ: Positive 14 · Negative 12 · Boundary 6 · Validation 2 · Auth 2 · State 5 · Integration 6 · Calculation 3 · Regression 1 (một TC có thể nhiều loại).
