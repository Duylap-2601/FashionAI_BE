# Test cases — FLW-003 (live try-on)

`Status` chỉ `PASS` khi có `EXEC` trong `05-execution.md`. Test chạy: Jest unit BE + node:test FE (mock/serialize), không phải WebRTC/provider thật.

## TS-013 — Eligibility và quota

### TC-093 — Feature tắt trả quota không dùng ngữ nghĩa ảnh
- **Related:** US-023 / AC-061, AC-067 / BR-082, BR-083 / SCR-026
- **Type:** Negative
- **Priority:** P0
- **Preconditions:** `settings.enabled=false`.
- **Actions:** `getQuota`.
- **Expected:** `enabled=false`, `unit='seconds'`, `remaining=0`.
- **Automation:** Yes — BE `live-try-on.service.spec.ts`
- **Status:** PASS (EXEC-039)

### TC-094 — FREE được dùng nếu policy bật
- **Related:** US-019 / AC-061 / BR-082 / SCR-026
- **Type:** Positive
- **Priority:** P1
- **Preconditions:** FREE `liveEnabled=true`, daily=120.
- **Actions:** `getQuota`.
- **Expected:** `enabled=true`, `eligible=true`, `limit=120`.
- **Automation:** Yes — `live-try-on.service.spec.ts`
- **Status:** PASS (EXEC-040)

### TC-095 — Gói hết hạn bị chặn
- **Related:** US-023 / AC-062 / BR-082 / SCR-026
- **Type:** Negative
- **Priority:** P0
- **Preconditions:** `tierExpiresAt` trong quá khứ.
- **Actions:** `getQuota`/create.
- **Expected:** `eligible=false`, `disabledReason=subscription_expired`; create 403.
- **Automation:** Yes
- **Status:** Not Run

### TC-096 — Active session hiện trong quota
- **Related:** US-023 / AC-063 / BR-094 / SCR-026
- **Type:** State
- **Priority:** P1
- **Preconditions:** lease còn hạn, session PAUSED.
- **Actions:** `getQuota`.
- **Expected:** `activeSession` có sessionId/productId/status/blockedUntil/remaining.
- **Automation:** Yes
- **Status:** Not Run

### TC-097 — Budget phiên = min(trần, user, global)
- **Related:** US-019 / AC-061, AC-068 / BR-097, BR-099, BR-100 / SCR-026
- **Type:** Boundary
- **Priority:** P0
- **Test data:** user còn 20s, trần 60; global còn 10; dưới min 5.
- **Actions:** create.
- **Expected:** reserve 20/10 tương ứng; dưới min → `LIVE_SESSION_BUDGET_TOO_LOW`.
- **Automation:** Yes
- **Status:** Not Run

## TS-014 — Garment, combo, prompt

### TC-098 — Ảnh lấy theo màu đã chọn
- **Related:** US-020 / AC-064 / BR-086 / SCR-026
- **Type:** Positive
- **Priority:** P1
- **Preconditions:** product có colors/images.
- **Actions:** `getGarment(product, 'BLACK')`.
- **Expected:** ảnh black, color chuẩn hoá, fetch ảnh đã dùng.
- **Automation:** Yes — `live-try-on.service.spec.ts`
- **Status:** PASS (EXEC-041)

### TC-099 — Màu không thuộc sản phẩm bị từ chối
- **Related:** US-020 / AC-064 / BR-086 / SCR-026
- **Type:** Negative
- **Priority:** P1
- **Actions:** `getGarment(product, 'Black')` khi chỉ có Cream.
- **Expected:** 400 `LIVE_GARMENT_COLOR_INVALID`; không fetch ảnh.
- **Automation:** Yes — `live-try-on.service.spec.ts`
- **Status:** PASS (EXEC-042)

### TC-100 — Sản phẩm và tổ hợp lớp không hợp lệ
- **Related:** US-020 / AC-064, AC-065 / BR-084, BR-087 / SCR-026
- **Type:** Validation
- **Priority:** P0
- **Test data:** non-UUID; không tồn tại; ARCHIVED; category lạ; FULL_BODY+INNER; 2 OUTER; 4 món.
- **Actions:** get/preview/create.
- **Expected:** đúng error code/message; không reserve.
- **Automation:** Yes
- **Status:** Not Run

### TC-101 — Ảnh không đọc được/sai content-type
- **Related:** US-019 / AC-064 / BR-085 / SCR-026
- **Type:** Error
- **Priority:** P1
- **Test data:** HTTP 404; timeout; `text/html`; 9MB.
- **Actions:** get garment.
- **Expected:** `LIVE_GARMENT_UNREADABLE`/`LIVE_GARMENT_BAD_CONTENT_TYPE`.
- **Automation:** Yes
- **Status:** Not Run

### TC-102 — Ưu tiên OUTER làm ảnh primary
- **Related:** US-020 / AC-066 / BR-088 / SCR-026
- **Type:** Calculation
- **Priority:** P1
- **Actions:** `pickPrimaryIndex([INNER, OUTER, BOTTOM])`.
- **Expected:** index của OUTER.
- **Automation:** Yes — `live-combo.util.spec.ts`
- **Status:** PASS (EXEC-043)

### TC-103 — Fallback FULL_BODY rồi INNER
- **Related:** US-020 / AC-066 / BR-088 / SCR-026
- **Type:** Boundary
- **Priority:** P1
- **Actions:** không OUTER; có FULL_BODY; chỉ INNER+BOTTOM.
- **Expected:** FULL_BODY trước INNER.
- **Automation:** Yes — `live-combo.util.spec.ts`
- **Status:** PASS (EXEC-044)

### TC-104 — Một món luôn là primary
- **Related:** US-020 / AC-066 / BR-088 / SCR-026
- **Type:** Positive
- **Priority:** P2
- **Actions:** `pickPrimaryIndex([BOTTOM])`.
- **Expected:** 0.
- **Automation:** Yes — `live-combo.util.spec.ts`
- **Status:** PASS (EXEC-045)

### TC-105 — Prompt mô tả đúng thứ tự lớp
- **Related:** US-020 / AC-066 / BR-089 / SCR-026
- **Type:** Positive
- **Priority:** P1
- **Actions:** `buildLiveComboPrompt` với BOTTOM/INNER/OUTER.
- **Expected:** OUTER trước INNER trước BOTTOM, một instruction.
- **Automation:** Yes — `live-combo.util.spec.ts`
- **Status:** PASS (EXEC-046)

### TC-106 — Prompt không vượt 700 ký tự
- **Related:** US-020 / AC-066 / BR-089 / SCR-026
- **Type:** Boundary
- **Priority:** P1
- **Actions:** prompt với mô tả dài.
- **Expected:** length ≤700, kết thúc bằng “…”, giữ tail instruction.
- **Automation:** Yes — `live-combo.util.spec.ts`
- **Status:** PASS (EXEC-047)

## TS-015 — Tạo phiên

### TC-107 — Tạo phiên reserve user/global + lease
- **Related:** US-019 / AC-068 / BR-095, BR-097…BR-101 / SCR-026
- **Type:** Positive
- **Priority:** P0
- **Preconditions:** user/global còn quota, không lease.
- **Actions:** create với productId + key.
- **Expected:** 2 budget update, lease upsert, token gọi với maxDuration=reserved; response ACTIVE + token một lần.
- **Automation:** Yes — `live-try-on.service.spec.ts`
- **Status:** PASS (EXEC-048)

### TC-108 — Key trùng khác body bị từ chối
- **Related:** US-019 / AC-069 / BR-092 / SCR-026
- **Type:** Negative
- **Priority:** P0
- **Actions:** create lại với body hash khác.
- **Expected:** 409 `IDEMPOTENCY_BODY_MISMATCH`; không mint token.
- **Automation:** Yes — `live-try-on.service.spec.ts`
- **Status:** PASS (EXEC-049)

### TC-109 — Key không phải UUID
- **Related:** US-019 / AC-069 / BR-091 / SCR-026
- **Type:** Validation
- **Priority:** P1
- **Actions:** create với key “abc”.
- **Expected:** 400 `INVALID_IDEMPOTENCY_KEY`.
- **Automation:** Yes
- **Status:** Not Run

### TC-110 — Key đã ISSUED không replay token
- **Related:** US-025 / AC-072 / BR-092, BR-093 / SCR-026
- **Type:** State
- **Priority:** P0
- **Actions:** create cùng key cùng body.
- **Expected:** 409 `SESSION_ALREADY_ISSUED`/`SESSION_PENDING`; không token.
- **Automation:** Yes
- **Status:** Not Run

### TC-111 — Hết slot concurrent fail closed
- **Related:** US-025 / AC-070 / BR-096 / SCR-026
- **Type:** Boundary
- **Priority:** P0
- **Preconditions:** lease count = max.
- **Actions:** create.
- **Expected:** 403 `LIVE_CONCURRENCY_EXCEEDED`; không gọi provider.
- **Automation:** Yes — `live-try-on.service.spec.ts`
- **Status:** PASS (EXEC-050)

### TC-112 — Provider lỗi release reservation/lease
- **Related:** US-025 / AC-071 / BR-102, BR-103 / SCR-026
- **Type:** Error
- **Priority:** P0
- **Preconditions:** Decart mint lỗi.
- **Actions:** create.
- **Expected:** 502; budget reserved giảm; lease xoá; session FAILED.
- **Automation:** Yes — `live-try-on.service.spec.ts`
- **Status:** PASS (EXEC-051)

## TS-016 — Pause / resume / end

### TC-113 — Resume không reserve lại
- **Related:** US-021 / AC-074, AC-075 / BR-106, BR-107 / SCR-026
- **Type:** State
- **Priority:** P0
- **Preconditions:** PAUSED, gửi productId khác.
- **Actions:** resume.
- **Expected:** token mới; budget không tăng; items thay bằng món mới.
- **Automation:** Yes — `live-try-on.service.spec.ts`
- **Status:** PASS (EXEC-052)

### TC-114 — Resume món không khả dụng không cấp token
- **Related:** US-021 / AC-074 / BR-106 / SCR-026
- **Type:** Negative
- **Priority:** P1
- **Actions:** resume với product ARCHIVED.
- **Expected:** lỗi; không token.
- **Automation:** Yes — `live-try-on.service.spec.ts`
- **Status:** PASS (EXEC-053)

### TC-115 — Pause chốt used và pauseExpiresAt
- **Related:** US-021 / AC-073 / BR-104, BR-105 / SCR-026
- **Type:** State
- **Priority:** P0
- **Preconditions:** ACTIVE 12s.
- **Actions:** pause; pause lần hai.
- **Expected:** PAUSED, used=12, pauseExpiresAt đúng policy; lần hai không đổi.
- **Automation:** Yes
- **Status:** Not Run

### TC-116 — End settle used và hoàn phần dư
- **Related:** US-022 / AC-076 / BR-109 / SCR-026
- **Type:** Calculation
- **Priority:** P0
- **Preconditions:** reserved 60, dùng 20.
- **Actions:** end; end lần hai.
- **Expected:** allocated=20, reserved giảm 60, lease xoá; lần hai không trừ thêm.
- **Automation:** Yes
- **Status:** Not Run

### TC-117 — Resume khi hết hạn/hết giây/không owner
- **Related:** US-021, US-025 / AC-074 / BR-106, BR-112 / SCR-026
- **Type:** Boundary/Auth
- **Priority:** P0
- **Test data:** pauseExpiresAt quá khứ; remaining 0; user khác.
- **Actions:** resume/get/pause/end.
- **Expected:** `LIVE_PAUSE_EXPIRED`/`LIVE_SESSION_EXHAUSTED`/404.
- **Automation:** Yes
- **Status:** Not Run

### TC-118 — Phiên PAUSED quá hạn phải terminal
- **Related:** US-022, US-026 / AC-077 / BR-111 / SCR-026
- **Type:** State
- **Priority:** P1
- **Preconditions:** PAUSED, blockedUntil quá khứ.
- **Actions:** worker settle; GET session.
- **Expected:** EXPIRED, không mời resume.
- **Actual (code):** giữ PAUSED → BUG-034.
- **Automation:** Yes
- **Status:** Not Run

## TS-017 — FE workspace

### TC-119 — Timer/resume khi quota ngày bằng 0
- **Related:** US-021, US-023 / AC-074 / BR-083, BR-107 / SCR-026
- **Type:** State
- **Priority:** P1
- **Preconditions:** phiên PAUSED còn 42s, daily remaining 0.
- **Actions:** render workspace.
- **Expected:** “Phiên còn 00:42”, “Đã tạm dừng”, resume bật, chọn lớp không bị khóa.
- **Automation:** Yes — FE `tests/live-workspace.test.cjs`
- **Status:** PASS (EXEC-054)

### TC-120 — ACTIVE khóa chọn đồ, pause bật
- **Related:** US-021 / AC-079 / BR-090 / SCR-026
- **Type:** UI/State
- **Priority:** P1
- **Preconditions:** status live, còn 8s.
- **Actions:** render.
- **Expected:** “Sắp hết thời gian”; garment slots disabled; pause bật; End hiện.
- **Automation:** Yes — FE `live-workspace.test.cjs`
- **Status:** PASS (EXEC-055)

### TC-121 — Khôi phục PAUSED từ server
- **Related:** US-021 / AC-079 / BR-106 / SCR-026
- **Type:** State
- **Priority:** P1
- **Preconditions:** không có session local, quota trả PAUSED 23s.
- **Actions:** render.
- **Expected:** timer 00:23; resume + end bật.
- **Automation:** Yes — FE `live-workspace.test.cjs`
- **Status:** PASS (EXEC-056)

### TC-122 — Transition khóa thao tác lặp
- **Related:** US-025 / AC-080 / BR-104 / SCR-026
- **Type:** Regression
- **Priority:** P2
- **Preconditions:** status pausing.
- **Actions:** render.
- **Expected:** “Đang tạm dừng”; nút chờ disabled; End disabled.
- **Automation:** Yes — FE `live-workspace.test.cjs`
- **Status:** PASS (EXEC-057)

## TS-018 — Admin và worker

### TC-123 — Admin GET/PUT + audit
- **Related:** US-024 / AC-078, AC-084 / BR-113, BR-114 / SCR-027
- **Type:** Positive
- **Priority:** P1
- **Preconditions:** role ADMIN.
- **Actions:** GET; PUT policy hợp lệ có reason.
- **Expected:** policy mới; version+1; audit before/after.
- **Automation:** Yes
- **Status:** Not Run

### TC-124 — Hai admin sửa đồng thời
- **Related:** US-024 / AC-078 / BR-115 / SCR-027
- **Type:** Consistency
- **Priority:** P1
- **Preconditions:** cả hai đọc version N.
- **Actions:** lưu lần lượt.
- **Expected:** người thứ hai nhận conflict và phải reload.
- **Actual (code):** last-write-wins → BUG-037.
- **Automation:** Yes
- **Status:** Not Run

### TC-125 — Beta allowlist
- **Related:** US-019 / AC-064 / BR-116 / SCR-026
- **Type:** Authorization
- **Priority:** P2
- **Preconditions:** allowlist không rỗng.
- **Actions:** get garment ngoài allowlist.
- **Expected:** `LIVE_PRODUCT_NOT_ALLOWED`.
- **Actual (code):** không enforce → BUG-038.
- **Automation:** Yes
- **Status:** Not Run

### TC-126 — Worker settle phiên hết hạn
- **Related:** US-026 / AC-077 / BR-110 / SCR-026
- **Type:** State
- **Priority:** P0
- **Preconditions:** RESERVED, blockedUntil quá khứ, ISSUING.
- **Actions:** `reconcileExpiredSessions`.
- **Expected:** EXPIRED, ISSUE_UNKNOWN, ALLOCATED, lease xoá.
- **Automation:** Yes — `live-try-on.service.spec.ts`
- **Status:** PASS (EXEC-058)

## TS-019 — FE combo reference

### TC-127 — Ghép upper+lower thành một ảnh
- **Related:** US-020 / AC-081 / BR-085, BR-088 / SCR-026
- **Type:** Positive
- **Priority:** P2
- **Actions:** `prepareLiveOutfitReference`.
- **Expected:** ảnh 1024×1024 chứa cả hai, bitmap close.
- **Automation:** Yes — FE `live-outfit-reference.test.cjs`
- **Status:** PASS (EXEC-059)

### TC-128 — Cặp không hợp lệ bị chặn trước khi tải ảnh
- **Related:** US-020 / AC-081 / BR-087 / SCR-026
- **Type:** Validation
- **Priority:** P2
- **Actions:** cùng product; upper không UPPER; lower không LOWER.
- **Expected:** lỗi tương ứng, không fetch.
- **Automation:** Yes — FE `live-outfit-reference.test.cjs`
- **Status:** PASS (EXEC-060)

### TC-129 — Tải ảnh lỗi không tạo ảnh dở
- **Related:** US-020 / AC-081 / BR-085 / SCR-026
- **Type:** Error
- **Priority:** P2
- **Actions:** fetch ảnh fail.
- **Expected:** reject; không trả blob.
- **Automation:** Yes — FE `live-outfit-reference.test.cjs`
- **Status:** PASS (EXEC-061)

## TS-020 — FE paused combo switch

### TC-130 — Đổi combo khi PAUSED phải được áp dụng
- **Related:** US-021 / AC-082 / BR-090, BR-108 / SCR-026
- **Type:** Regression
- **Priority:** P1
- **Preconditions:** phiên PAUSED, outfitMode, chọn món khác.
- **Actions:** bấm Tiếp tục.
- **Expected:** món mới vào phiên qua resume.
- **Actual (code):** `start()` chỉ gửi product khi `!outfitMode` → món mới bị bỏ qua (BUG-033).
- **Automation:** Yes
- **Status:** Not Run
