# User stories & acceptance criteria — FLW-005 (subscription)

Không có tài liệu yêu cầu gốc; story suy ra từ UI/API và được ghi rõ. Giá/quota là dữ liệu cấu hình, không phải cam kết vĩnh viễn.

## US-035 — Mua gói MEMBER/VIP

- **Actor:** USER (FREE hoặc chưa có gói)
- **Story:** As a người dùng, I want mua gói MEMBER/VIP bằng ZaloPay hoặc SePay, so that tôi có thêm lượt AI và quyền lợi theo gói.
- **Description:** Checkout tạo Order PENDING, redirect cổng, webhook xác nhận, cấp tier.
- **Preconditions:** JWT; không có SCHEDULED.
- **Postconditions:** Order PAID; một ACTIVE; `User.tier` khớp.
- **Priority:** P0
- **Source:** `BE/src/modules/payments/payments.service.ts:createCheckoutLink:75`; `subscription.service.ts:createOrExtendSubscription:396`; `FE/src/features/subscription/components/subscription-page.tsx:proceedCheckout:114`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-109…AC-116

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-109 | Khách chưa đăng nhập | Gọi `GET /payments/plans` | Trả 3 gói FREE/MEMBER/VIP với giá và quota; không cần auth | Verified (TC-178) |
| AC-110 | User FREE | Bấm mua gói | Tạo Order PENDING `targetTier`, amount 34k/99k; trả `checkoutUrl` + `paymentId`/`orderCode` | Verified (TC-182) |
| AC-111 | `targetTier=FREE` | Checkout | 400; không tạo order | Verified (TC-180) |
| AC-112 | Provider MoMo | Checkout gói | 400 trước khi tạo order; không có order rác | Verified (TC-181) |
| AC-113 | User đang có gói khác còn hạn và đã hẹn downgrade | Mua gói mới | 409; hướng dẫn huỷ lịch hẹn | Unverified (TC-183) |
| AC-114 | Checkout sai định dạng | Gửi body rỗng/orderId sai/provider lạ | 400 validation | Verified (TC-183) |
| AC-115 | Cổng trả callback hợp lệ | Thanh toán đơn gói | Order PAID; tier cấp đúng; thông báo thành công | Verified (TC-197) |
| AC-116 | Callback gửi hai lần | Xử lý lại | Không cấp tier/không tạo payment lần hai | Verified (TC-199) |

## US-036 — Gia hạn cùng gói không mất ngày

- **Actor:** USER đang có gói
- **Story:** As a hội viên, I want mua thêm cùng gói, so that 30 ngày mới nối tiếp ngày hết hạn hiện tại.
- **Preconditions:** ACTIVE cùng tier còn hạn.
- **Postconditions:** `expiresAt` +30 ngày; dòng RENEWED giữ vết đơn.
- **Priority:** P0
- **Source:** `subscription.service.ts:createOrExtendSubscription:481`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-117…AC-118

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-117 | ACTIVE còn hạn | Mua cùng tier | Hạn mới = hạn cũ + 30 ngày; không tạo ACTIVE thứ hai | Verified (TC-193) |
| AC-118 | Gói còn hạn | Gia hạn | Dòng ACTIVE giữ `orderId` gốc; dòng RENEWED mang đơn mới | Verified (TC-193, TC-194) |

## US-037 — Nâng cấp giữa kỳ, chỉ trả chênh lệch

- **Actor:** USER MEMBER
- **Story:** As a MEMBER, I want nâng lên VIP ngay, so that tôi dùng được quyền lợi VIP mà chỉ trả phần chênh lệch còn lại.
- **Preconditions:** MEMBER còn >1 ngày.
- **Postconditions:** VIP hiệu lực ngay; hạn giữ theo quote nếu còn hiệu lực.
- **Priority:** P1
- **Source:** `payments.service.ts:createSubscriptionOrder:189`; `subscription.service.ts:611`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-119…AC-121

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-119 | MEMBER còn 15 ngày | Checkout VIP | Amount = net proration (credit MEMBER, debit VIP), trả breakdown | Verified (TC-185) |
| AC-120 | Còn ≤1 ngày | Checkout VIP | Thu full giá VIP như renewal; không prorate | Verified (TC-186) |
| AC-121 | Quote hợp lệ khi webhook | Cấp VIP | Hiệu lực ngay, `expiresAt` giữ nguyên chu kỳ đã trả; quote cũ/khác tier/quá 24h thì cấp theo số tiền | Verified (TC-189…TC-193) |

## US-038 — Hẹn hạ gói

- **Actor:** USER VIP
- **Story:** As a VIP, I want hẹn chuyển xuống MEMBER khi gói hiện tại hết hạn, so that tôi không bị trừ tiền sớm và vẫn dùng hết kỳ.
- **Preconditions:** VIP còn hạn; mua MEMBER.
- **Postconditions:** Dòng SCHEDULED bắt đầu đúng hạn VIP; VIP giữ đến hết hạn.
- **Priority:** P2
- **Source:** `subscription.service.ts:createOrExtendSubscription:647`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-122…AC-123

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-122 | VIP còn hạn | Mua MEMBER | Không hạ tier ngay; tạo SCHEDULED `startsAt=VIP.expiresAt` | Unverified (TC-221) |
| AC-123 | Có SCHEDULED | Mua gói mới | 409; huỷ lịch là điều kiện tiên quyết | Unverified (TC-183) |

## US-039 — Quản lý nhắc gia hạn

- **Actor:** USER có gói
- **Story:** As a hội viên, I want tắt/bật nhắc gia hạn và huỷ lịch chuyển gói, so that tôi kiểm soát việc gia hạn nhưng vẫn dùng đến hết hạn.
- **Description:** `autoRenew` chỉ là cờ nhắc; hệ thống **không** tự trừ tiền.
- **Preconditions:** ACTIVE.
- **Postconditions:** Cờ đổi; quyền lợi không đổi; thông báo được tạo.
- **Priority:** P1
- **Source:** `subscription.service.ts:cancelAutoRenew:197`, `resumeAutoRenew:241`, `cancelScheduledSubscription:286`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-124…AC-126

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-124 | ACTIVE autoRenew=true | POST cancel | autoRenew=false; vẫn dùng đến `expiresAt`; thông báo | Unverified (TC-204) |
| AC-125 | ACTIVE autoRenew=false | POST resume | autoRenew=true; thông báo nhắc trước 3 ngày | Unverified (TC-205) |
| AC-126 | Có SCHEDULED | POST scheduled/cancel | SCHEDULED=CANCELLED; ACTIVE bật lại autoRenew; không hoàn tiền | Verified (TC-201) |

## US-040 — Xem gói và lịch sử

- **Actor:** USER
- **Story:** As a người dùng, I want xem gói hiện tại, hạn dùng và lịch sử mua, so that tôi biết mình đang có quyền lợi gì.
- **Preconditions:** JWT.
- **Postconditions:** Dữ liệu khớp DB; tier hết hạn hiển thị FREE.
- **Priority:** P1
- **Source:** `subscription.service.ts:getCurrentSubscription:111`, `getSubscriptionHistory:163`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-127…AC-128

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-127 | Có ACTIVE/SCHEDULED | GET me | Trả tier hiệu lực, hạn, autoRenew, current, scheduled, isFree | Unverified (TC-202) |
| AC-128 | Có nhiều giao dịch | GET history | Mới nhất trước; `limit` kẹp 1..100; meta đúng | Unverified (TC-203) |

## US-041 — Hoàn tiền thu hồi quyền lợi

- **Actor:** ADMIN / hệ thống refund
- **Story:** As a hệ thống, I want thu hồi gói khi đơn gói được hoàn toàn bộ, so that quyền lợi không bị dùng miễn phí.
- **Preconditions:** Refund COMPLETED đủ số tiền.
- **Postconditions:** Gói/đơn bị huỷ hoặc khôi phục gói trước; tier hạ đúng; idempotent.
- **Priority:** P1
- **Source:** `subscription.service.ts:revokeEntitlementForRefundedOrder:690`; `payments.service.ts:revokeSubscriptionEntitlementForRefund:947`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-129…AC-131

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-129 | Đơn gói hoàn toàn bộ | Refund COMPLETED | Huỷ gói, hạ về FREE hoặc gói còn lại; thông báo | Verified (TC-206, TC-212, TC-215) |
| AC-130 | Hoàn một phần | Refund < amountPaid | Không thu hồi gì | Verified (TC-207, TC-213) |
| AC-131 | Hoàn đơn gia hạn/nâng cấp | Refund COMPLETED | Lùi đúng phần cộng dồn/khôi phục gói cũ; hoàn payment trùng không cắt gói | Verified (TC-209, TC-210, TC-211, TC-214) |

## US-042 — Nhắc gia hạn và trạng thái sau thanh toán

- **Actor:** USER / job
- **Story:** As a hội viên, I want được nhắc trước khi hết hạn và thấy đúng trạng thái sau thanh toán, so that tôi không mất gói ngoài ý muốn.
- **Description:** Cron trước 3 ngày, lock phân tán, tạo order SePay + email; return page poll.
- **Preconditions:** ACTIVE autoRenew=true, chưa nhắc, không có SCHEDULED.
- **Postconditions:** Một nhắc/email; return page hiển thị PAID/đang xác nhận.
- **Priority:** P1
- **Source:** `payments.service.ts:sendRenewalReminders:2052`; `FE/src/features/payments/components/payment-success-page.tsx:CONFIRM_TIMEOUT_MS:19`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-132

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-132 | Gói hết hạn trong 3 ngày | Cron chạy | Chỉ một instance gửi; tạo/reuse order SePay; email + notification; đánh dấu đã nhắc | Verified (TC-216, TC-217); return page chưa chạy (TC-220) |
