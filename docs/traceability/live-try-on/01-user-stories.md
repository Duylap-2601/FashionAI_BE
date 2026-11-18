# US + AC — FLW-003 (live try-on)

Nguồn: `FashionAI_BE` + `FashionAI_FE` tại thời điểm 2026-11-18; intent từ `plans/decart-lucy-live-try-on-flow-and-business-rules.md` và `plans/live-try-on-quota-admin-and-pause-plan.md`. Story không có ticket gốc được đánh dấu `Inferred from existing implementation`.

## US-019 — Bắt đầu phiên thử đồ trực tiếp

- **Actor:** Customer
- **Story:** As an eligible customer, I want to start a realtime try-on session for a catalog product, so that I can see the garment on my camera feed.
- **Description:** FE đọc quota, kiểm tra sản phẩm/ảnh, xin camera, tạo session một lần và nhận credential tạm.
- **Preconditions:** Đăng nhập, feature/tier bật, còn quota, không có lease.
- **Postconditions:** Session ACTIVE, budget reserved, lease active, FE có client token dùng một lần.
- **Priority:** P0
- **Source:** Inferred from `live-try-on.controller.ts`, `use-live-try-on.ts`
- **Confidence:** High
- **Related AC:** AC-061, AC-068, AC-069, AC-072

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-061 | Feature bật, tier hợp lệ, còn quota | Mở tab Live | `GET /try-on/live/quota` trả `enabled=true`, `eligible=true`, `remaining>0`, `maxDurationSeconds` | Verified |
| AC-068 | Sản phẩm hợp lệ, không có lease | Bấm bắt đầu | `POST /sessions` trả `sessionId`, token một lần, trạng thái ACTIVE, `remainingSeconds` | Verified |
| AC-069 | Cùng `Idempotency-Key` được gửi lại | Gửi lại request | Không mint token thứ hai; trả 409 `SESSION_ALREADY_ISSUED`/`SESSION_PENDING` hoặc mismatch | Verified |
| AC-072 | Phiên đã tạo | Đọc `GET /sessions/:id` | Không trả lại `clientToken` | Unverified |

## US-020 — Phối bộ nhiều món trong một phiên

- **Actor:** Customer
- **Story:** As a customer, I want to try a coordinated outfit in one session, so that I do not need multiple quota sessions for one look.
- **Description:** Combo tối đa 3 món, mỗi lớp một món, FULL_BODY đứng riêng; Decart nhận một ảnh primary, các món còn lại mô tả bằng prompt.
- **Preconditions:** Các sản phẩm ACTIVE, đúng category, có ảnh đọc được.
- **Postconditions:** Session lưu `live_try_on_session_items`; prompt/ảnh primary đúng thứ tự lớp.
- **Priority:** P1
- **Source:** Inferred from `garment-combo.util.ts`, `live-combo.util.ts`, `live-try-on.service.ts:724-832`
- **Confidence:** High
- **Related AC:** AC-064, AC-065, AC-066, AC-081

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-064 | Sản phẩm có nhiều màu/ảnh | Chọn màu | Ảnh garment lấy đúng ảnh màu; màu không thuộc sản phẩm bị từ chối | Verified |
| AC-065 | Combo có FULL_BODY + món khác, trùng lớp, hoặc >3 | Gửi session | 400 với message lý do; không reserve quota | Unverified |
| AC-066 | Combo nhiều lớp | Tạo prompt | Prompt mô tả đúng thứ tự OUTER → INNER → FULL_BODY → BOTTOM; ≤700 ký tự | Verified |
| AC-081 | Combo upper+lower ở FE | Chuẩn bị ảnh tham chiếu | Ảnh 1024×1024 chứa cả hai, không crop; lỗi tải → không tạo ảnh dở | Verified |

## US-021 — Tạm dừng và tiếp tục

- **Actor:** Customer
- **Story:** As a customer, I want to pause when I leave the tab or lag, and resume later, so that I do not burn quota while not using the camera.
- **Description:** Pause chốt `usedSeconds`, đặt `pauseExpiresAt`, giữ quota còn lại; resume mint token mới cho số giây còn lại.
- **Preconditions:** Session ACTIVE/PAUSED thuộc user.
- **Postconditions:** PAUSED → ACTIVE; budget không bị reserve lần hai.
- **Priority:** P0
- **Source:** Inferred from `pauseSession`, `resumeSession`, `use-live-try-on.ts:67-216`
- **Confidence:** High
- **Related AC:** AC-073, AC-074, AC-075, AC-082

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-073 | Session ACTIVE | Bấm pause/pagehide/background | Session PAUSED; `usedSeconds` chốt; `pauseExpiresAt` set; lease còn | Unverified |
| AC-074 | Session PAUSED còn hạn | Bấm resume | Token mới; ACTIVE; countdown theo `remainingSeconds` server | Verified |
| AC-075 | Session PAUSED | Resume | Không reserve thêm user/global; budget giữ nguyên | Verified |
| AC-082 | Session PAUSED, combo mode | Chọn món khác rồi resume | Món mới được áp dụng hoặc UI chặn rõ ràng | Unverified |

## US-022 — Kết thúc và quyết toán quota

- **Actor:** Customer, Worker
- **Story:** As a customer, I want the session to settle only the seconds actually used, so that I can use the rest of my daily quota.
- **Description:** End tính used, chuyển reserved → allocated, xoá lease; worker settle phiên bỏ dở khi hết `blockedUntil`.
- **Preconditions:** Session RESERVED.
- **Postconditions:** ENDED/EXPIRED, ALLOCATED, lease xoá; không settle hai lần.
- **Priority:** P0
- **Source:** Inferred from `endSession`, `settleExpiredSession`, `reconcileExpiredSessions`
- **Confidence:** High
- **Related AC:** AC-076, AC-077

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-076 | Session đang chạy, dùng 20/60s | Bấm End | ENDED; allocated=20; reserved giảm 60; lease xoá | Unverified |
| AC-077 | Session RESERVED quá `blockedUntil` | Worker chạy | Reserved → allocated theo used; EXPIRED (nếu ACTIVE); lease xoá | Verified |

## US-023 — Thấy quota và trạng thái phiên

- **Actor:** Customer
- **Story:** As a customer, I want to see daily seconds and any active/paused session, so that I know why I can or cannot start.
- **Description:** Quota trả limit/reserved/allocated/remaining/resetAt và `activeSession` nếu lease còn hiệu lực.
- **Preconditions:** Đăng nhập.
- **Postconditions:** UI disable đúng lý do; resume đúng sản phẩm/phiên.
- **Priority:** P1
- **Source:** Inferred from `getQuota`, `live-try-on-workspace.tsx`
- **Confidence:** High
- **Related AC:** AC-062, AC-063, AC-067

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-062 | Tier hết hạn | Mở quota | `eligible=false`, lý do `subscription_expired` | Unverified |
| AC-063 | Còn lease active | Mở quota | `activeSession` có sessionId/productId/status/blockedUntil/remainingSeconds | Unverified |
| AC-067 | Feature tắt | Mở quota | `enabled=false`, `limit=0`, không dùng quota ảnh | Verified |

## US-024 — Admin cấu hình policy

- **Actor:** Admin
- **Story:** As an admin, I want to change live policy per tier without deploy, so that I can control cost and rollout.
- **Description:** GET/PUT settings, version tăng, audit before/after, validate category/tier/quota.
- **Preconditions:** Role ADMIN.
- **Postconditions:** Policy mới có hiệu lực cho phiên mới; audit ghi nhận.
- **Priority:** P1
- **Source:** Inferred from `admin-stats.controller.ts:54-80`, DTO, plan §5
- **Confidence:** High
- **Related AC:** AC-078, AC-084

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-078 | Admin hợp lệ | PUT settings | Policy lưu DB, version tăng, response `source=database` | Unverified |
| AC-084 | Admin sửa policy | Lưu | `live_try_on_policy_audits` có before/after/actor/reason | Unverified |

## US-025 — Credential và an toàn provider

- **Actor:** Customer (bảo mật), BE
- **Story:** As a customer, I want my provider credential to be short-lived and never exposed in status/logs, so that it cannot be reused or leaked.
- **Description:** API key chỉ ở BE; client token TTL ngắn, giới hạn model/origin/max duration; token không lưu DB.
- **Preconditions:** Provider được cấu hình.
- **Postconditions:** Token chỉ trả trong response tạo/resume; status không chứa token.
- **Priority:** P0
- **Source:** Inferred from `decart-realtime.service.ts:41-92`, `createSession`, `mapSessionStatus`
- **Confidence:** High
- **Related AC:** AC-070, AC-071, AC-083

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-070 | Hết slot concurrent | Tạo session | 403, không gọi provider | Verified |
| AC-071 | Provider lỗi mint token | Tạo session | Reservation + lease được release; session FAILED | Verified |
| AC-083 | Response bất kỳ | Đọc session/quota | Không có `DECART_API_KEY` hay client token trong payload/status | Unverified |

## US-026 — Worker thu hồi phiên bỏ dở

- **Actor:** Worker / Operator
- **Story:** As an operator, I want abandoned sessions settled automatically, so that quota and concurrency do not leak.
- **Description:** Cron mỗi phút xử lý tối đa 50 phiên RESERVED quá `blockedUntil`; retry serializable.
- **Preconditions:** Session RESERVED, credential ISSUING/ISSUED/ISSUE_UNKNOWN.
- **Postconditions:** ALLOCATED, lease xoá, credential ISSUE_UNKNOWN nếu đang ISSUING.
- **Priority:** P1
- **Source:** Inferred from `reconcileExpiredSessions`, `settleExpiredSession`
- **Confidence:** High
- **Related AC:** AC-077, AC-080

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-077 | Session RESERVED quá hạn | Cron chạy | Settle đúng một lần, trạng thái EXPIRED nếu ACTIVE, lease xoá | Verified |
| AC-080 | FE đang ở trạng thái chuyển | Poll/refetch | UI khóa thao tác lặp, hiện “đang tạm dừng/tiếp tục” | Verified |
