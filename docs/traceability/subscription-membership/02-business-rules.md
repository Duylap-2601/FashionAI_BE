# Business rules — FLW-005 (subscription)

## A. Giá, gói, checkout

### BR-156 — Checkout gói yêu cầu đăng nhập
- **Statement:** Mọi thao tác mua/quản lý gói cần JWT; chỉ bảng giá là public.
- **Type:** Authorization
- **Condition:** Gọi checkout/subscriptions/me/history/cancel/resume.
- **Expected behavior:** 401 khi thiếu token; plans trả 200.
- **Exception:** Webhook public nhưng phải xác thực chữ ký.
- **Related US/AC:** US-035 / AC-109, AC-110
- **Enforcement point:** `BE/src/modules/payments/payments.controller.ts:checkout:44-47`; `getPlans:252-258`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-157 — Danh sách gói public và nhất quán
- **Statement:** `GET /payments/plans` trả FREE/MEMBER/VIP với giá, thời hạn, quota từng action; không cần auth.
- **Type:** Calculation / Consistency
- **Condition:** Mọi request plans.
- **Expected behavior:** `durationDays` 0 cho FREE, 30 cho MEMBER/VIP; quota `null` biểu thị không giới hạn.
- **Exception:** FE có fallback tĩnh khi API lỗi (BR-190).
- **Related US/AC:** US-035 / AC-109
- **Enforcement point:** `BE/src/common/constants/subscription-plans.constants.ts:buildPlanList:145-174`; `payments.controller.ts:getPlans:252`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-158 — Giá và chu kỳ
- **Statement:** FREE 0; MEMBER 34.000đ/30 ngày; VIP 99.000đ/30 ngày; đơn vị VND.
- **Type:** Calculation
- **Condition:** Tạo order hoặc hiển thị giá.
- **Expected behavior:** Giá lấy từ `TIER_PRICES`; không nhận giá từ client.
- **Exception:** Upgrade giữa kỳ dùng net proration (BR-169).
- **Related US/AC:** US-035, US-037 / AC-110, AC-119
- **Enforcement point:** `subscription-plans.constants.ts:TIER_PRICES:8-12`; `SUBSCRIPTION_DURATION_DAYS:21`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-159 — Không thể mua FREE
- **Statement:** `targetTier=FREE` bị từ chối trước khi tạo order.
- **Type:** Validation
- **Condition:** Client gửi FREE.
- **Expected behavior:** 400, hướng dẫn dùng cancel.
- **Exception:** Không.
- **Related US/AC:** US-035 / AC-111
- **Enforcement point:** `BE/src/modules/payments/payments.service.ts:createSubscriptionOrder:190-194`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-160 — Gói chỉ thanh toán qua ZaloPay/SePay
- **Statement:** MoMo bị từ chối cho đơn gói; sản phẩm vẫn dùng được MoMo.
- **Type:** Validation / Integration
- **Condition:** `targetTier` + provider.
- **Expected behavior:** 400 trước khi tạo order; kiểm tra lại theo order thực tế.
- **Exception:** Không.
- **Related US/AC:** US-035 / AC-112
- **Enforcement point:** `payments.service.ts:assertSubscriptionProvider:126-135`; `createCheckoutLink:76-88`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-161 — Order gói có targetTier, amount, PENDING/CREATED
- **Statement:** Checkout tạo Order mới với `targetTier`, amount server-side, `status=CREATED`, `paymentStatus=PENDING`, `orderCode` duy nhất.
- **Type:** Consistency
- **Condition:** Checkout hợp lệ.
- **Expected behavior:** Không tạo order nếu validation/provider fail.
- **Exception:** Có thể lưu `prorationSnapshot`.
- **Related US/AC:** US-035 / AC-110
- **Enforcement point:** `payments.service.ts:createSubscriptionOrder:189-252`; `createCheckoutLink:80-84`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-162 — Provider được kiểm tra trước khi tạo order
- **Statement:** `assertSubscriptionProvider` chạy trước `createSubscriptionOrder` và sau khi resolve order cũ.
- **Type:** Consistency
- **Condition:** Mọi checkout.
- **Expected behavior:** Request bị từ chối không để lại order rác.
- **Exception:** Không.
- **Related US/AC:** US-035 / AC-112
- **Enforcement point:** `payments.service.ts:createCheckoutLink:76-88`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-163 — SCHEDULED chặn mua gói mới
- **Statement:** Nếu user có bất kỳ subscription `SCHEDULED`, checkout gói mới trả 409.
- **Type:** Workflow
- **Condition:** `targetTier` được gửi.
- **Expected behavior:** 409 kèm tier/ngày bắt đầu; FE mở modal huỷ lịch.
- **Exception:** Huỷ lịch xong mới mua lại được.
- **Related US/AC:** US-038 / AC-113, AC-123
- **Enforcement point:** `payments.service.ts:createSubscriptionOrder:198-208`; `FE subscription-page.tsx:isAxios409:135`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-164 — Link thanh toán có TTL 24 giờ
- **Statement:** `checkoutExpiresAt = now + 24h`; link hết hạn không dùng để claim PAID.
- **Type:** Constraint
- **Condition:** Tạo link SePay/gateway.
- **Expected behavior:** Payment sau TTL bị từ chối/xử lý hoàn theo cổng.
- **Exception:** Gateway có thể có TTL riêng ngắn hơn.
- **Related US/AC:** US-035 / AC-110
- **Enforcement point:** `payments.service.ts:CHECKOUT_TTL_MS`; `createCheckoutLink:95-106`; `createSePayCheckoutLink:288`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-165 — Response checkout phân biệt gói và sản phẩm
- **Statement:** Trả `kind='SUBSCRIPTION'` khi có `targetTier`, kèm `proration` nếu upgrade; sản phẩm trả `PRODUCT`.
- **Type:** Consistency
- **Condition:** Checkout thành công.
- **Expected behavior:** FE chọn đúng màn hình/return copy.
- **Exception:** Không.
- **Related US/AC:** US-035, US-037 / AC-110, AC-119
- **Enforcement point:** `payments.service.ts:createCheckoutLink:108-115`; `FE payment-copy.ts:isSubscriptionPurchase:7`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

## B. Xác nhận thanh toán & cấp quyền

### BR-166 — Chỉ ghi nhận thanh toán đã xác thực và đúng số tiền
- **Statement:** Webhook phải qua chữ ký; `amount >= order.amount` (provider làm tròn) và order phải CREATED/PENDING.
- **Type:** Integration / Validation
- **Condition:** Callback/IPN.
- **Expected behavior:** Sai chữ ký/amount/trạng thái → từ chối, ghi webhook failure; không đổi tier.
- **Exception:** Admin confirm-manual cho chuyển khoản.
- **Related US/AC:** US-035 / AC-115
- **Enforcement point:** `payments.service.ts:handleGatewayCallback`; `handleSePayBankWebhook`; `payments-webhook.e2e-spec.ts:325`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-167 — Claim PAID atomic
- **Statement:** Chỉ một luồng được chuyển order CREATED/PENDING → PAID bằng `updateMany` có điều kiện; thua thì trả "already processed".
- **Type:** Consistency
- **Condition:** Hai webhook/IPN đồng thời.
- **Expected behavior:** Một payment, một lần cấp gói.
- **Exception:** Không.
- **Related US/AC:** US-035 / AC-116
- **Enforcement point:** `payments.service.ts:claim order:1540-1565`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-168 — NEW: tạo ACTIVE + cập nhật user
- **Statement:** Không có ACTIVE còn hạn → tạo subscription ACTIVE 30 ngày, `autoRenew=true`, cập nhật `User.tier/tierExpiresAt`.
- **Type:** State
- **Condition:** Mode NEW.
- **Expected behavior:** Quyền lợi hiệu lực ngay.
- **Exception:** Nếu order có proration quote bất thường, cấp theo số tiền (BR-171).
- **Related US/AC:** US-035 / AC-115
- **Enforcement point:** `subscription.service.ts:createOrExtendSubscription:427-479`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-169 — RENEWAL cộng dồn
- **Statement:** Cùng tier còn hạn → `expiresAt = hạn cũ + 30 ngày`; tạo dòng RENEWED giữ `orderId` mới; ACTIVE giữ order gốc.
- **Type:** Calculation / State
- **Condition:** Mode RENEWAL.
- **Expected behavior:** Không mất ngày, không tạo ACTIVE thứ hai.
- **Exception:** ACTIVE bị đóng đồng thời → xử lý lại trên dòng thay thế.
- **Related US/AC:** US-036 / AC-117, AC-118
- **Enforcement point:** `subscription.service.ts:481-546`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-170 — UPGRADE hiệu lực ngay
- **Statement:** Lên tier cao hơn → đóng ACTIVE cũ, tạo ACTIVE mới ngay; nếu quote còn hợp lệ thì giữ `expiresAt` cũ, nếu không thì cấp theo số tiền.
- **Type:** State / Calculation
- **Condition:** Mode UPGRADE.
- **Expected behavior:** Quyền lợi mới ngay; không cộng thêm 30 ngày khi đã trả net.
- **Exception:** Quote cũ/khác tier/quá 24h → BR-171.
- **Related US/AC:** US-037 / AC-121
- **Enforcement point:** `subscription.service.ts:547-612`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-171 — Quote không dùng được thì quy đổi theo số tiền
- **Statement:** `grantedDays = round(paid / planPrice * 30)`, kẹp 1..30; không tặng 30 ngày nếu chỉ trả một phần.
- **Type:** Calculation
- **Condition:** Quote thiếu/khác tier/quá 24h/gói đã hết hạn.
- **Expected behavior:** Quyền lợi tương ứng số tiền thực thu.
- **Exception:** `paid <= 0` → 1 ngày.
- **Related US/AC:** US-037 / AC-121
- **Enforcement point:** `subscription.service.ts:resolveGrantedDays:87-95`; `:555-575`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-172 — DOWNGRADE tạo SCHEDULED
- **Statement:** Xuống tier thấp hơn → tạo SCHEDULED bắt đầu đúng `current.expiresAt`, kéo dài 30 ngày; ACTIVE hiện tại tắt autoRenew, không đổi tier ngay.
- **Type:** State / Workflow
- **Condition:** Mode DOWNGRADE.
- **Expected behavior:** Dùng hết kỳ hiện tại rồi mới hạ.
- **Exception:** Lịch cũ bị thay.
- **Related US/AC:** US-038 / AC-122
- **Enforcement point:** `subscription.service.ts:647-687`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-173 — Tối đa một ACTIVE/user
- **Statement:** Mọi luồng ghi phải đóng ACTIVE cũ trước khi tạo mới; partial unique index bảo đảm.
- **Type:** Constraint
- **Condition:** Mọi mode.
- **Expected behavior:** Không có hai ACTIVE; truy vấn luôn lọc `status=ACTIVE`.
- **Exception:** Dòng ACTIVE hết hạn nhưng cron chưa dọn vẫn chiếm suất → đóng khi NEW.
- **Related US/AC:** US-035, US-036 / AC-117
- **Enforcement point:** `subscription.service.ts:findActiveSubscription:63-75`; migration `one_active_subscription_per_user`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-174 — Mua mới huỷ SCHEDULED cũ
- **Statement:** Mode NEW đóng mọi SCHEDULED trước khi cấp gói mới.
- **Type:** State
- **Condition:** NEW có lịch hẹn cũ.
- **Expected behavior:** Lịch cũ không còn hiệu lực.
- **Exception:** Checkout đã bị 409 nếu SCHEDULED tồn tại (BR-163), nên nhánh này chỉ xảy ra khi lịch phát sinh trong lúc thanh toán.
- **Related US/AC:** US-038 / AC-123
- **Enforcement point:** `subscription.service.ts:432-438`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-175 — Cấp quyền trong transaction claim
- **Statement:** Order/payment/subscription/user được cập nhật trong cùng transaction; lỗi thì rollback toàn bộ.
- **Type:** Consistency
- **Condition:** Webhook hợp lệ.
- **Expected behavior:** Không có order PAID mà chưa cấp gói.
- **Exception:** Notification/outbox chạy sau commit, lỗi không fail webhook.
- **Related US/AC:** US-035 / AC-115
- **Enforcement point:** `payments.service.ts:1535-1645`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-176 — Callback trùng idempotent
- **Statement:** Payment/order đã PAID trả thành công; unique `(provider, transactionId)` và claim điều kiện chặn cấp hai lần.
- **Type:** Integration / Consistency
- **Condition:** Webhook lặp.
- **Expected behavior:** Không tạo payment/gói lần hai.
- **Exception:** Không.
- **Related US/AC:** US-035 / AC-116
- **Enforcement point:** `payments.service.ts:1537-1545`; `P2002` catch; `payments-webhook.e2e-spec.ts:352`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-177 — Thông báo theo mode
- **Statement:** NEW/UPGRADE/RENEWAL/DOWNGRADE có title/message riêng; gửi sau commit, lỗi realtime không fail webhook.
- **Type:** Workflow
- **Condition:** Claim PAID thắng.
- **Expected behavior:** User thấy đúng "đã nâng cấp"/"đã hẹn chuyển gói".
- **Exception:** Không.
- **Related US/AC:** US-035, US-038 / AC-115, AC-122
- **Enforcement point:** `payments.service.ts:1670-1698`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

## C. Nhắc gia hạn

### BR-178 — Nhắc trước 3 ngày, một lần
- **Statement:** Cron tìm ACTIVE `autoRenew=true`, chưa nhắc, hết hạn trong 3 ngày, không có SCHEDULED; gửi notification + email; đánh dấu `renewalReminderSentAt`.
- **Type:** Workflow
- **Condition:** Chạy hằng ngày.
- **Expected behavior:** Mỗi subscription một lần nhắc; lock Redis chống trùng giữa instance.
- **Exception:** Lỗi một subscription không chặn các subscription khác.
- **Related US/AC:** US-042 / AC-132
- **Enforcement point:** `payments.service.ts:sendRenewalReminders:2052-2170`; `subscription.service.ts:findSubscriptionsDueForRenewal:337`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-179 — `autoRenew` chỉ là nhắc, không tự trừ tiền
- **Statement:** Không có cron charge; mỗi lần gia hạn là một checkout riêng. Tắt `autoRenew` chỉ dừng nhắc, không cắt quyền.
- **Type:** Workflow / Calculation
- **Condition:** Mọi gói.
- **Expected behavior:** UI ghi "nhắc gia hạn", không phải autopay.
- **Exception:** Không.
- **Related US/AC:** US-039 / AC-124, AC-125
- **Enforcement point:** `subscription.service.ts:cancelAutoRenew:197`; `payments.service.ts:sendRenewalReminders`; `FE current-subscription.tsx:104-118`
- **Intended / Enforced:** yes / yes (tên field dễ hiểu nhầm — BUG-063) · **Confidence:** High · **Verification:** Code-verified

## D. Hoàn tiền

### BR-180 — Hoàn toàn bộ thu hồi quyền lợi
- **Statement:** Khi tổng refund COMPLETED ≥ amountPaid của đơn gói, huỷ gói mua từ đơn; hạ user về FREE hoặc gói ACTIVE còn lại.
- **Type:** State / Consistency
- **Condition:** Refund toàn bộ.
- **Expected behavior:** Quyền lợi và refund khớp trong cùng transaction; thông báo sau commit.
- **Exception:** Hoàn payment trùng (`PAYMENT_ONLY`) không cắt gói.
- **Related US/AC:** US-041 / AC-129
- **Enforcement point:** `subscription.service.ts:revokeEntitlementForRefundedOrder:690-850`; `payments.service.ts:947-975`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-181 — Hoàn một phần không thu hồi
- **Statement:** `refunded < amountPaid` → không đổi gói.
- **Type:** Calculation
- **Condition:** Refund một phần.
- **Expected behavior:** Giữ nguyên tier/hạn.
- **Exception:** Không.
- **Related US/AC:** US-041 / AC-130
- **Enforcement point:** `subscription.service.ts:revokeEntitlementForRefundedOrder:710-714`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-182 — Hoàn gia hạn lùi phần cộng dồn
- **Statement:** Refund đơn RENEWAL lùi `expiresAt` của ACTIVE về `startsAt` của dòng RENEWED, không xoá cả gói gốc.
- **Type:** Calculation / State
- **Condition:** Đơn hoàn là RENEWAL.
- **Expected behavior:** Chỉ mất 30 ngày vừa mua.
- **Exception:** Không.
- **Related US/AC:** US-041 / AC-131
- **Enforcement point:** `subscription.service.ts:revoke...:720-770`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-183 — Hoàn upgrade khôi phục gói cũ
- **Statement:** Refund đơn UPGRADE huỷ gói mới; nếu gói cũ còn hạn (dòng CANCELLED giữ expiresAt) thì kích hoạt lại thay vì hạ FREE.
- **Type:** State
- **Condition:** Đơn hoàn là UPGRADE.
- **Expected behavior:** Khôi phục đúng quyền lợi đã trả trước đó.
- **Exception:** Gói cũ đã hết hạn → FREE.
- **Related US/AC:** US-041 / AC-131
- **Enforcement point:** `subscription.service.ts:revoke...:770-835`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-184 — Thu hồi idempotent
- **Statement:** Lần refund thứ hai không còn dòng để huỷ → trả null, không sửa state/thông báo lần hai.
- **Type:** Consistency
- **Condition:** Refund/finalize lặp.
- **Expected behavior:** Không âm thầm hạ thêm tier.
- **Exception:** Không.
- **Related US/AC:** US-041 / AC-131
- **Enforcement point:** `subscription.service.ts:revoke...:690-720`; `subscription-refund-revocation.spec.ts:153`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

## E. Đọc trạng thái & web FE

### BR-185 — GET me trả tier hiệu lực
- **Statement:** Trả `tier` đã hết hạn → FREE, `tierExpiresAt`, `current`, `scheduled`, `isFree`, `daysRemaining`.
- **Type:** Consistency
- **Condition:** User đăng nhập.
- **Expected behavior:** UI hiển thị đúng gói/hạn; user không tồn tại → 404.
- **Exception:** Không.
- **Related US/AC:** US-040 / AC-127
- **Enforcement point:** `subscription.service.ts:getCurrentSubscription:111-161`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-186 — Lịch sử phân trang
- **Statement:** Mới nhất trước; `limit` kẹp 1..100; meta `{total,page,limit,totalPages}`; `page`/`limit` validate ở DTO (`@Min(1)`, `@Max(100)`).
- **Type:** Constraint
- **Condition:** GET history.
- **Expected behavior:** Trang hợp lệ đúng dữ liệu; `page=-1`/`abc` → 400 từ DTO (đã kiểm chứng TC-203).
- **Exception:** Service không tự clamp `page`, chỉ dựa DTO — phòng thủ nội bộ thiếu (BUG-059, Low).
- **Related US/AC:** US-040 / AC-128
- **Enforcement point:** `subscription.service.ts:getSubscriptionHistory:163-195`; `subscription-history-query.dto.ts:5-16`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-187 — Tắt nhắc có điều kiện
- **Statement:** Chỉ tắt khi ACTIVE và `autoRenew=true`; nếu đã tắt → 400; không có gói → 404; giữ nguyên `expiresAt`.
- **Type:** State
- **Condition:** POST cancel.
- **Expected behavior:** Phản hồi `accessUntil`; tạo notification.
- **Exception:** Hai request đồng thời chỉ một thắng.
- **Related US/AC:** US-039 / AC-124
- **Enforcement point:** `subscription.service.ts:cancelAutoRenew:197-239`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-188 — Bật nhắc có điều kiện
- **Statement:** Chỉ bật khi ACTIVE và `autoRenew=false`; nếu đang bật → 400; không có gói → 404.
- **Type:** State
- **Condition:** POST resume.
- **Expected behavior:** Bật nhắc 3 ngày; không gia hạn/không trừ tiền.
- **Exception:** Không.
- **Related US/AC:** US-039 / AC-125
- **Enforcement point:** `subscription.service.ts:resumeAutoRenew:241-284`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-189 — Huỷ lịch hẹn không hoàn tiền
- **Statement:** SCHEDULED → CANCELLED; bật lại autoRenew cho ACTIVE; không hoàn đơn đã trả; 404 nếu không có lịch.
- **Type:** State
- **Condition:** POST scheduled/cancel.
- **Expected behavior:** Gói hiện tại tiếp tục đến hết hạn.
- **Exception:** Không.
- **Related US/AC:** US-039 / AC-126
- **Enforcement point:** `subscription.service.ts:cancelScheduledSubscription:286-335`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-190 — FE lấy giá từ API, fallback tĩnh
- **Statement:** `usePlans` gọi `/payments/plans`; nếu lỗi/không có dữ liệu, UI dùng `DEFAULT_PLANS` (34k/99k, quota hiện tại).
- **Type:** Integration / Error handling
- **Condition:** Tải trang gói.
- **Expected behavior:** Trang vẫn hiển thị; giá fallback có thể cũ (BUG-060).
- **Exception:** Không.
- **Related US/AC:** US-035 / AC-109
- **Enforcement point:** `FE/src/features/subscription/components/subscription-plans.tsx:plans useMemo:74-105`; `queries.ts:fetchPlans:14`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-191 — FE checkout gửi targetTier/provider
- **Statement:** Gói dùng `POST /payments/checkout` với `targetTier` và provider `SEPAY`/`ZALOPAY`; 409 mở modal huỷ lịch; proration mở breakdown trước redirect.
- **Type:** Workflow
- **Condition:** Bấm nâng cấp.
- **Expected behavior:** Không gửi orderId cho đơn gói.
- **Exception:** Lỗi khác hiện toast message từ BE.
- **Related US/AC:** US-035, US-037 / AC-110, AC-119
- **Enforcement point:** `FE/src/features/payments/services/mutations.ts:checkout:4-12`; `subscription-page.tsx:proceedCheckout:114-143`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-192 — FE hiển thị breakdown proration
- **Statement:** Nếu response có `proration`, không redirect ngay; hiển thị credit/debit/net và xác nhận.
- **Type:** Workflow
- **Condition:** Upgrade giữa kỳ.
- **Expected behavior:** User thấy số tiền trước khi trả.
- **Exception:** Không.
- **Related US/AC:** US-037 / AC-119
- **Enforcement point:** `subscription-page.tsx:120-131`; proration dialog
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified

### BR-193 — Return page poll và invalidate cache
- **Statement:** `/payment/success` đọc `orderId/orderCode`, poll order 2 s/lần tối đa 20 s; khi PAID xoá cache subscription/quota; `/payment/result?paymentId=` poll payment tương tự.
- **Type:** Workflow / Integration
- **Condition:** Quay về từ cổng.
- **Expected behavior:** Hiển thị đúng PAID/đang xác nhận, không báo thất bại khi webhook chậm.
- **Exception:** Link cũ thiếu orderId → tra theo orderCode; không thấy → trạng thái trung tính.
- **Related US/AC:** US-042 / AC-132
- **Enforcement point:** `FE/src/features/payments/components/payment-success-page.tsx:CONFIRM_TIMEOUT_MS:19-23,76-105`; `payment-result-page.tsx:31-36`; `payment-cache.ts:invalidateAfterPayment`
- **Intended / Enforced:** yes / yes · **Confidence:** High · **Verification:** Code-verified
