# Defects — FLW-005 (subscription)

Tất cả là **defect candidate** từ code + test; chưa có reproduction trên staging với ZaloPay/SePay/Postgres/Redis thật.

Phạm vi: chỉ defect của workflow gói thành viên. Defect đơn sản phẩm/hoàn tiền sản phẩm nằm ở `checkout-to-delivery/06-defects.md`.

## BUG-058 — Mua mới khi đang có SCHEDULED chỉ được chặn ở checkout, không chặn ở webhook

- **Severity:** Medium · **Priority:** P2 · **Status:** Open (candidate)
- **Related:** US-035, US-038 / AC-113, AC-123 / BR-163, BR-174 / TC-183
- **Environment:** `POST /payments/checkout` → webhook.
- **Reproduction:**
  1. User VIP còn hạn, huỷ/lịch hẹn phát sinh **sau** khi đã tạo order checkout (hoặc hai tab checkout song song).
  2. Order đã tạo vẫn được thanh toán; webhook gọi `createOrExtendSubscription`.
  3. Mode NEW mới đóng SCHEDULED (BR-174) — nhưng nếu mode là UPGRADE/DOWNGRADE thì nhánh đó không chạy.
- **Expected:** mọi mode phải kiểm tra lại SCHEDULED tại thời điểm cấp quyền, không chỉ ở checkout.
- **Actual:** chặn 409 chỉ ở `createSubscriptionOrder`; nhánh webhook không kiểm tra lại.
- **Evidence:** `BE/src/modules/payments/payments.service.ts:createSubscriptionOrder:202-210` (409); `BE/src/modules/payments/subscription.service.ts:createOrExtendSubscription:432-438` (chỉ NEW đóng SCHEDULED).
- **Root cause:** kiểm tra chỉ đặt ở biên checkout, không phải ở điểm ghi quyền lợi.
- **Resolution:** kiểm tra SCHEDULED trong transaction cấp quyền cho mọi mode; nếu có thì đóng lịch cũ hoặc từ chối.
- **Test hiện có:** TC-183 xác nhận 409 ở checkout, **không** phủ nhánh race này.

## BUG-059 — `page` lịch sử gói được DTO validate, nhưng fallback service vẫn nhận giá trị thô

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate) — **không tái hiện qua HTTP**
- **Related:** US-040 / AC-128 / BR-186 / TC-203
- **Environment:** `GET /payments/subscriptions/history`.
- **Reproduction:** gọi service trực tiếp với `page=0`/`page='abc'` (bỏ qua DTO).
- **Expected:** service tự chặn/ clamp để không phụ thuộc hoàn toàn vào DTO.
- **Actual:** `getSubscriptionHistory` chỉ kẹp `limit`, không kẹp `page`; `skip = (page-1)*limit` có thể âm/NaN nếu gọi nội bộ.
- **Evidence:** `BE/src/modules/payments/subscription.service.ts:getSubscriptionHistory:163-165`; DTO `subscription-history-query.dto.ts:5-16` (`@Min(1)`, `@Max(100)`).
- **Root cause:** hàng rào đặt hết ở DTO, service không phòng thủ.
- **Resolution:** clamp `page` trong service như ai-stylist đã làm.
- **Đính chính bằng chứng:** BR-186 ghi "page không validate" là **sai** — DTO đã validate. Qua HTTP `page=-1`/`abc` trả 400, không 500 (TC-203 PASS). Giữ BUG ở mức Low vì chỉ là phòng thủ nội bộ.

## BUG-060 — Giá FE fallback tĩnh lệch khỏi hằng số BE khi giá đổi

- **Severity:** Medium · **Priority:** P2 · **Status:** Open (candidate)
- **Related:** US-035 / AC-109 / BR-190 / TC-178
- **Environment:** `/subscription` khi `GET /payments/plans` lỗi.
- **Reproduction:**
  1. Admin đổi `TIER_PRICES` (deploy) → BE trả giá mới.
  2. FE không tải được plans (mạng lỗi) → dùng `DEFAULT_PLANS`.
  3. User thấy giá cũ; bấm mua và bị thu số tiền mới.
- **Expected:** giá hiển thị luôn khớp giá server thu, hoặc chặn mua khi không tải được giá.
- **Actual:** hai nguồn giá độc lập, không có kiểm tra khớp.
- **Evidence:** `FE/src/features/subscription/components/subscription-plans.tsx:useMemo:74-105`; `BE/src/common/constants/subscription-plans.constants.ts:TIER_PRICES:9-13`.
- **Root cause:** fallback tĩnh sao chép giá thay vì dẫn xuất từ nguồn duy nhất.
- **Resolution:** fallback chỉ hiển thị nhãn/quota, ẩn giá khi không có dữ liệu thật; hoặc chặn CTA mua.

## BUG-061 — Modal 409 huỷ lịch không nêu gói/ngày bắt đầu một cách nhất quán

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-038 / AC-113, AC-123 / BR-163 / TC-183
- **Environment:** `/subscription` khi checkout trả 409.
- **Reproduction:** có SCHEDULED, bấm nâng cấp → BE trả message có tier + ngày; FE chỉ toast/hiện message thô.
- **Expected:** modal nêu rõ "đang hẹn gói X từ ngày Y" và CTA huỷ lịch.
- **Actual:** 409 được nhận diện để mở modal nhưng không parse `startsAt`/`tier`, dựa vào message chuỗi tiếng Việt.
- **Evidence:** `FE/src/features/subscription/components/subscription-page.tsx:isAxios409:135`; `BE/src/modules/payments/payments.service.ts:createSubscriptionOrder:206-210` (ConflictException message).
- **Root cause:** lỗi 409 trả message văn xuôi thay vì `details {tier, startsAt}` có cấu trúc.
- **Resolution:** trả `details` có cấu trúc; FE đọc `details` thay vì so khớp message.

## BUG-062 — Không có test phủ return page poll 20 s / invalidate cache

- **Severity:** Medium · **Priority:** P2 · **Status:** Open (candidate) — thiếu bằng chứng
- **Related:** US-042 / AC-132 / BR-193 / TC-220
- **Environment:** `/payment/success`, `/payment/result`.
- **Reproduction:** không có; đây là khoảng trống bằng chứng, không phải hành vi sai đã tái hiện.
- **Expected:** có test (kể cả fake timer) chứng minh poll 2 s ≤ 20 s, PAID → invalidate subscription/quota, PENDING không báo thất bại.
- **Actual:** chỉ có `payment-display.test.cjs` cho nhãn/kết quả; logic poll nằm trong component.
- **Evidence:** `FE/src/features/payments/components/payment-success-page.tsx:CONFIRM_TIMEOUT_MS:19-23`; `05-execution.md` EXEC-158 BLOCKED.
- **Root cause:** repo chưa có React Testing Library; poll gắn chặt vào component.
- **Resolution:** tách logic poll/invalidate thành hàm thuần (như `stylist-page-state.ts`) rồi test bằng `node:test`.

## BUG-063 — `autoRenew` bị hiểu là autopay

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-039 / AC-124, AC-125 / BR-179
- **Environment:** UI gói hiện tại + tên field API.
- **Reproduction:** user đọc "tự động gia hạn" và tưởng hệ thống tự trừ tiền; thực tế chỉ là nhắc.
- **Expected:** nhãn phản ánh đúng "nhắc gia hạn", không hàm ý autopay.
- **Actual:** field/API `autoRenew` + copy "bật lại tự động gia hạn" dễ gây hiểu nhầm rằng có charge định kỳ.
- **Evidence:** `BE/src/modules/payments/payments.controller.ts:resumeAutoRenew:310-323` (message "Đã bật lại tự động gia hạn"); `FE/src/features/subscription/components/current-subscription.tsx:104-118`; BR-179 xác nhận code **không** có cron charge.
- **Root cause:** thuật ngữ cũ giữ nguyên khi nghiệp vụ đổi thành nhắc.
- **Resolution:** đổi copy/field sang `renewalReminder` ở response UI; giữ `autoRenew` trong DB nếu đổi tên quá tốn kém, nhưng map ở DTO.

## Tổng hợp

| Severity | Số | ID |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 3 | BUG-058, BUG-060, BUG-062 |
| Low | 3 | BUG-059, BUG-061, BUG-063 |
| **Tổng** | **6** | BUG-058…BUG-063 |

Ghi chú: BUG-059 là defect **phòng thủ nội bộ**, không tái hiện qua HTTP. BUG-062 là thiếu bằng chứng, không phải hành vi sai. Không có Critical/High vì mọi luồng cấp/thu quyền lợi đều có test PASS trên mock.
