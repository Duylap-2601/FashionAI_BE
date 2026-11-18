# Execution — FLW-005 (subscription)

Chỉ ghi kết quả **thật**. Môi trường: `HEAD` BE (Jest unit + e2e, mock Prisma/Redis/gateway), `HEAD` FE (`node:test`). Ngày 2026-11-18. Không có ZaloPay/SePay/Postgres/Redis/browser thật.

`PASS` = đã chạy và hành vi khớp kỳ vọng. `BLOCKED` = cần môi trường không có trong CI (browser/timer thật).

| EXEC | TC | Ngày | Build | Status | Thực tế | Bằng chứng |
|---|---|---|---|---|---|---|
| EXEC-116 | TC-178 | 2026-11-18 | HEAD | PASS | 3 gói FREE/MEMBER/VIP; giá 0/34k/99k; duration 0/30/30; quota VIP `null`+`unlimited` | `test/e2e/subscription-endpoints.e2e-spec.ts` › *TC-178: public, trả 3 gói* |
| EXEC-117 | TC-179 | 2026-11-18 | HEAD | PASS | chưa có gói → `tier=FREE`, `current/scheduled=null`, `isFree=true` | `subscription-endpoints.e2e-spec.ts` › *TC-179* |
| EXEC-118 | TC-180 | 2026-11-18 | HEAD | PASS | `targetTier=FREE` → 400, không tạo order | `payments-checkout.e2e-spec.ts` › *từ chối gói FREE* |
| EXEC-119 | TC-181 | 2026-11-18 | HEAD | PASS | MoMo cho gói → 400 và `order.create` không được gọi | `payments-checkout.e2e-spec.ts` › *từ chối MoMo cho gói thành viên* |
| EXEC-120 | TC-182 | 2026-11-18 | HEAD | PASS | Order `targetTier=MEMBER`, amount 34000; response có `proration` field | `payments-checkout.e2e-spec.ts` › *tạo Order mới với targetTier* |
| EXEC-121 | TC-183 | 2026-11-18 | HEAD | PASS | body rỗng / orderId không UUID / provider lạ → 400; có SCHEDULED → 409 và không tạo order | `payments-checkout.e2e-spec.ts` › *validation*; `subscription-endpoints.e2e-spec.ts` › *TC-183* |
| EXEC-122 | TC-184 | 2026-11-18 | HEAD | PASS | user đang ở MEMBER vẫn mua MEMBER được (không 409) | `payments-checkout.e2e-spec.ts` › *cho phép gia hạn khi user đã ở gói đó* |
| EXEC-123 | TC-185 | 2026-11-18 | HEAD | PASS | credit 17000, debit 50000, net 33000; checkout trả amount 33000 + `prorationSnapshot` | `subscription-proration.spec.ts`; `payments-checkout.e2e-spec.ts` › *upgrade giữa kỳ được prorate* |
| EXEC-124 | TC-186 | 2026-11-18 | HEAD | PASS | còn 12h → amount 99000, `proration=null` | `payments-checkout.e2e-spec.ts` › *upgrade khi sắp hết hạn* |
| EXEC-125 | TC-187 | 2026-11-18 | HEAD | PASS | 30 ngày: credit 34000, debit 99000, net 65000; net ≥ 0 | `subscription-proration.spec.ts` › *full 30 ngày* + *net không âm* |
| EXEC-126 | TC-188 | 2026-11-18 | HEAD | PASS | đơn sản phẩm PAID, `user.update` không được gọi | `payments-webhook.e2e-spec.ts` › *đơn sản phẩm ... không đổi tier* |
| EXEC-127 | TC-189 | 2026-11-18 | HEAD | PASS | đơn gói → `subscription.create` tier MEMBER + `user.update` tier; quote còn hạn giữ `expiresAt` | `payments-webhook.e2e-spec.ts` › *nâng tier khi đơn là subscription*; `subscription-lifecycle.spec.ts` › *quote còn hiệu lực* |
| EXEC-128 | TC-190 | 2026-11-18 | HEAD | PASS | quote >24h → `grantedDays` theo số tiền (10 ngày cho 33k) | `subscription-lifecycle.spec.ts` › *quote cũ vì quá 24h* |
| EXEC-129 | TC-191 | 2026-11-18 | HEAD | PASS | `oldTier` ≠ tier hiện tại → cấp theo số tiền | `subscription-lifecycle.spec.ts` › *quote trỏ tới gói khác* |
| EXEC-130 | TC-192 | 2026-11-18 | HEAD | PASS | trả đủ giá → 30 ngày; trả một nửa → ~15 ngày, kẹp 1..30 | `subscription-lifecycle.spec.ts` › *trả đủ giá gói* + *quote cũ vì gói đã hết hạn* |
| EXEC-131 | TC-193 | 2026-11-18 | HEAD | PASS | `expiresAt` = hạn cũ + 30 ngày; ACTIVE giữ `orderId` gốc; dòng RENEWED mang đơn mới; 1 ACTIVE | `subscription-lifecycle.spec.ts` › *RENEWAL cộng 30 ngày* + *giữ orderId gốc* |
| EXEC-132 | TC-194 | 2026-11-18 | HEAD | PASS | ACTIVE quá hạn bị đóng trước khi tạo ACTIVE mới | `subscription-lifecycle.spec.ts` › *ACTIVE cũ đã hết hạn* |
| EXEC-133 | TC-195 | 2026-11-18 | HEAD | PASS | amount callback < order → 200 ack nhưng không claim PAID/không đổi tier | `payments-webhook.e2e-spec.ts` › *từ chối khi số tiền không khớp* |
| EXEC-134 | TC-196 | 2026-11-18 | HEAD | PASS | signature sai / X-Secret-Key sai → từ chối, không đổi trạng thái | `payments-webhook.e2e-spec.ts` › *signature không đúng*, *X-Secret-Key sai* |
| EXEC-135 | TC-197 | 2026-11-18 | HEAD | PASS | claim PAID + enqueue đúng 1 event; lỗi enqueue không fail webhook | `payments-webhook.e2e-spec.ts` › *enqueue đúng một event*, *lỗi enqueue không làm fail webhook* |
| EXEC-136 | TC-198 | 2026-11-18 | HEAD | PASS | đơn CANCELLED không được ghi nhận thanh toán | `payments-webhook.e2e-spec.ts` › *không ghi nhận thanh toán cho đơn đã hủy* |
| EXEC-137 | TC-199 | 2026-11-18 | HEAD | PASS | webhook lặp → "duplicate", không cấp lần hai | `payments-webhook.e2e-spec.ts` › *idempotent: đơn đã thanh toán không xử lý lại* |
| EXEC-138 | TC-200 | 2026-11-18 | HEAD | PASS | TRANSACTION_VOID → đơn CANCELLED + trả lượt coupon | `payments-webhook.e2e-spec.ts` › *TRANSACTION_VOID trả lại lượt mã giảm giá* |
| EXEC-139 | TC-201 | 2026-11-18 | HEAD | PASS | SCHEDULED→CANCELLED, ACTIVE `autoRenew=true`; không có lịch → 404 | `payments-checkout.e2e-spec.ts` › *hủy SCHEDULED và bật lại auto-renew*, *trả 404 khi không có lịch hẹn* |
| EXEC-140 | TC-202 | 2026-11-18 | HEAD | PASS | me trả `current`/`scheduled`/`daysRemaining`; tier hết hạn → FREE; user không tồn tại → 404 | `subscription-endpoints.e2e-spec.ts` › *TC-202* (3 test) |
| EXEC-141 | TC-203 | 2026-11-18 | HEAD | PASS | skip/take theo page/limit, meta đủ field; limit kẹp 1..100 | `test/unit/subscription-history.spec.ts` |
| EXEC-142 | TC-204 | 2026-11-18 | HEAD | PASS | tắt nhắc → `autoRenew=false` + `accessUntil` + thông báo; đã tắt → 400; không gói → 404 | `subscription-endpoints.e2e-spec.ts` › *TC-204* (3 test) |
| EXEC-143 | TC-205 | 2026-11-18 | HEAD | PASS | bật nhắc → `autoRenew=true`; đang bật → 400 | `subscription-endpoints.e2e-spec.ts` › *TC-205* (2 test) |
| EXEC-144 | TC-206 | 2026-11-18 | HEAD | PASS | hoàn toàn bộ → huỷ gói, `tier=FREE` | `subscription-refund-revocation.spec.ts` › *hoàn toàn bộ đơn gói: hủy gói và hạ user về FREE* |
| EXEC-145 | TC-207 | 2026-11-18 | HEAD | PASS | refund < amountPaid → không thu hồi | `subscription-refund-revocation.spec.ts` › *hoàn một phần thì không thu hồi* |
| EXEC-146 | TC-208 | 2026-11-18 | HEAD | PASS | đơn không `targetTier` → bỏ qua | `subscription-refund-revocation.spec.ts` › *đơn sản phẩm ... bỏ qua hoàn toàn* |
| EXEC-147 | TC-209 | 2026-11-18 | HEAD | PASS | `expiresAt` ACTIVE lùi về `startsAt` dòng RENEWED | `subscription-refund-revocation.spec.ts` › *hoàn đơn gia hạn* |
| EXEC-148 | TC-210 | 2026-11-18 | HEAD | PASS | khôi phục gói cũ còn hạn thay vì FREE | `subscription-refund-revocation.spec.ts` › *hoàn đơn nâng cấp* |
| EXEC-149 | TC-211 | 2026-11-18 | HEAD | PASS | `refundScope=PAYMENT_ONLY` không cắt gói | `subscription-refund-revocation.spec.ts` › *payment thu trùng* |
| EXEC-150 | TC-212 | 2026-11-18 | HEAD | PASS | finalize full hạ tier + báo khách; finalize một phần không đụng gói | `subscription-refund-revocation.spec.ts` › *finalizeGatewayRefund hoàn toàn bộ*, *hoàn một phần thì không đụng* |
| EXEC-151 | TC-213 | 2026-11-18 | HEAD | PASS | finalize refund đơn sản phẩm không update `subscription` | `subscription-refund-revocation.spec.ts` › *hoàn đơn sản phẩm qua finalize* |
| EXEC-152 | TC-214 | 2026-11-18 | HEAD | PASS | refund SUCCESS qua cổng đồng bộ thu hồi gói | `subscription-refund-revocation.spec.ts` › *refundGatewayPayment SUCCESS* |
| EXEC-153 | TC-215 | 2026-11-18 | HEAD | PASS | còn gói ACTIVE khác → giữ gói đó | `subscription-refund-revocation.spec.ts` › *còn gói ACTIVE khác thì giữ* |
| EXEC-154 | TC-216 | 2026-11-18 | HEAD | PASS | lần refund thứ hai không sửa state | `subscription-refund-revocation.spec.ts` › *idempotent* |
| EXEC-155 | TC-217 | 2026-11-18 | HEAD | PASS | có lock: gửi nhắc 1 lần, `markRenewalReminderSent`, tạo order | `test/unit/renewal-reminder-lock.spec.ts` › *lấy được lock* |
| EXEC-156 | TC-218 | 2026-11-18 | HEAD | PASS | không lấy được lock → thoát sớm, không mail/không tạo order; luôn release lock | `renewal-reminder-lock.spec.ts` › *không lấy được lock*, *release lock cả khi lỗi* |
| EXEC-157 | TC-219 | 2026-11-18 | HEAD | PASS | query chỉ ACTIVE + autoRenew + `renewalReminderSentAt=null` + hết hạn trong 3 ngày + `none: SCHEDULED` | `subscription-history.spec.ts` › *TC-219: chỉ ACTIVE + autoRenew…* |
| EXEC-158 | TC-220 | 2026-11-18 | HEAD | BLOCKED | Page poll 20 s + invalidate cache cần browser/timer thật — unit FE hiện chỉ chạy `payment-display` | `tests/payment-display.test.cjs` (chưa phủ return page) |
| EXEC-159 | TC-221 | 2026-11-18 | HEAD | PASS | DOWNGRADE tạo SCHEDULED `startsAt=VIP.expiresAt`, 30 ngày; không đổi `User.tier`; ACTIVE `autoRenew=false` | `subscription-lifecycle.spec.ts` › *TC-221* |

## Tổng hợp lần chạy

| Suite | Tests | Kết quả |
|---|---:|---|
| BE `subscription-lifecycle.spec.ts` | 11 | PASS |
| BE `subscription-proration.spec.ts` | 4 | PASS |
| BE `subscription-refund-revocation.spec.ts` | 12 | PASS |
| BE `renewal-reminder-lock.spec.ts` | 3 | PASS |
| BE `subscription-history.spec.ts` (mới) | 3 | PASS |
| BE `payments-checkout.e2e-spec.ts` | 21 | PASS |
| BE `payments-webhook.e2e-spec.ts` | 26 | PASS |
| BE `subscription-endpoints.e2e-spec.ts` (mới) | 11 | PASS |
| BE `payments-unmatched.e2e-spec.ts` | 2 | PASS |
| FE `payment-display.test.cjs` | 5 | PASS |

Tổng: **BE unit 33 + BE e2e 60 + FE 5 = 98 test PASS** trong phạm vi FLW-005.

## Lệnh tái lập

```bash
cd D:/EXE/FashionAI_BE
npx jest --config test/jest-unit.json --runInBand \
  test/unit/subscription-lifecycle.spec.ts \
  test/unit/subscription-proration.spec.ts \
  test/unit/subscription-refund-revocation.spec.ts \
  test/unit/renewal-reminder-lock.spec.ts \
  test/unit/subscription-history.spec.ts
npx jest --config test/jest-e2e.json \
  test/e2e/payments-checkout.e2e-spec.ts \
  test/e2e/payments-webhook.e2e-spec.ts \
  test/e2e/subscription-endpoints.e2e-spec.ts

cd D:/EXE/FashionAI_FE
node --test tests/payment-display.test.cjs
```

## Giới hạn bằng chứng

- Không gọi ZaloPay/SePay thật: mọi gateway đều mock; chữ ký được ký bằng secret test.
- Không chạy Postgres/Redis thật: `subscription updateMany` count, partial unique index và lock Redis chỉ được mô phỏng.
- Không có browser test: return page poll 20 s, invalidate cache và UX modal 409 chưa được chứng minh (TC-220 BLOCKED).
- BUG-059/060 (page không validate / fallback giá) không tái hiện vì DTO đã có `@Min(1)`, `@Max(100)`; ghi ở `06-defects.md`.
