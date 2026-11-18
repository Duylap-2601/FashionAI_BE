# Screens, components, APIs — FLW-005 (subscription)

## SCR-030 — `/subscription`

- **Route / Module / Purpose:** `FE/src/app/(main)/subscription/page.tsx` → `features/subscription/components/subscription-page.tsx`; bảng giá, gói hiện tại, lịch sử, mua/gia hạn/huỷ lịch.
- **Roles:** khách xem được bảng giá; user đăng nhập mới thấy gói của tôi/lịch sử/mua.
- **Entry conditions:** trực tiếp, từ `SubscriptionRequiredModal`, hoặc link nhắc gia hạn.
- **Related US/BR:** US-035…US-040 / BR-156…BR-165, BR-185…BR-192.

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-071 | `subscription-page.tsx` | Orchestrator tab, checkout, modal 409/proration | BR-163, BR-191, BR-192 |
| CMP-072 | `subscription-plans.tsx` | So sánh 3 gói, giá/quota | BR-157, BR-158, BR-190 |
| CMP-073 | `current-subscription.tsx` | Hạn, auto-renew, scheduled | BR-185, BR-187, BR-188, BR-189 |
| CMP-074 | `subscription-history.tsx` | Lịch sử mua | BR-186 |
| CMP-075 | Proration dialog | Credit/debit/net trước redirect | BR-192 |
| CMP-076 | Scheduled-conflict modal | 409 → huỷ lịch | BR-163 |
| CMP-077 | Payment method selector | ZaloPay/SePay | BR-160 |
| CMP-084 | `SubscriptionRequiredModal.tsx` | Upsell khi quota/AI bị chặn | BR-157 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-072 | GET | `/api/payments/plans` | Giá/quota public |
| API-073 | POST | `/api/payments/checkout` | Tạo order + link |
| API-074 | GET | `/api/payments/subscriptions/me` | Gói hiện tại |
| API-075 | GET | `/api/payments/subscriptions/history` | Lịch sử |
| API-076 | POST | `/api/payments/subscriptions/cancel` | Tắt nhắc |
| API-077 | POST | `/api/payments/subscriptions/resume` | Bật nhắc |
| API-078 | POST | `/api/payments/subscriptions/scheduled/cancel` | Huỷ lịch hẹn |
| API-081 | GET | `/api/users/me/quota?action=…` | Quota sau khi đổi tier (phụ thuộc) |

**States**

| State | Trigger | UI |
|---|---|---|
| initial | mount | Bảng giá; nếu auth thì tải me/history |
| loading | plans/me/history | Skeleton/nút "Đang xử lý" |
| free | tier FREE | Gói hiện tại = Miễn phí; CTA nâng cấp |
| active | tier MEMBER/VIP | Hạn, ngày còn lại, auto-renew, giá đã trả |
| scheduled | có SCHEDULED | Khối "Gói X đã lên lịch" + huỷ |
| checkout error 400 | FREE/MoMo/validation | Toast message BE |
| checkout conflict 409 | có lịch hẹn | Modal huỷ lịch |
| proration | response có `proration` | Dialog breakdown trước redirect |
| plans API error | `/plans` fail | Fallback `DEFAULT_PLANS` (BUG-060) |

**Interactions:** chọn tab → query; nâng cấp → `checkout`; 409 → `cancelScheduledSubscription` rồi thử lại; tắt/bật nhắc → mutation + invalidate; huỷ lịch → confirm + invalidate; lịch sử → phân trang 10.

## SCR-031 — Payment return pages

- **Routes:** `/payment/success`, `/payment/result`, `/payment/error`, `/payment/cancel`.
- **Purpose:** hiển thị trạng thái sau khi cổng redirect; không tự xác nhận thanh toán.
- **Roles:** user đã đăng nhập (unauthenticated thấy nhắc đăng nhập).
- **Related US/BR:** US-035, US-042 / BR-165, BR-193.

| CMP | Component | Purpose | Rules |
|---|---|---|---|
| CMP-078 | `payment-success-page.tsx` | SePay return; resolve order theo orderId/orderCode; poll 20 s | BR-193 |
| CMP-079 | `payment-result-page.tsx` | `paymentId` return; poll status | BR-193 |
| CMP-080 | `payment-outcome.tsx` | Card PAID/PENDING/FAILED/REFUND_REQUIRED | BR-193 |
| CMP-083 | `payment-cache.ts` | Invalidate subscription/quota/orders | BR-193 |

| API | Method | Endpoint | Purpose |
|---|---|---|---|
| API-079 | GET | `/api/payments/:paymentId` | Trạng thái payment |
| API-075/074 | GET | history/me | Hiển thị sau PAID |
| API-081 | GET | quota | Làm mới hạn mức |

**States:** loading; pending (poll 2 s, timeout 20 s); PAID (subscription copy + CTA `/subscription`); FAILED; REFUND_REQUIRED; unauthenticated; missing/invalid order → neutral/error.

**Interactions:** PAID → `invalidateAfterPayment` → CTA xem gói; PENDING → tiếp tục poll; error/cancel → về `/subscription` chọn lại.

## Ghi chú

- Không có màn admin riêng cho subscription; admin dùng refund flow chung ở payments.
- `API-080` gồm `POST /payments/sepay-ipn`, `/sepay-webhook`, `/zalopay/callback`; MoMo bị chặn cho đơn gói.
- `API-072` public; mọi API còn lại cần JWT trừ webhook.
