# Defects — FLW-003 (live try-on)

Tất cả là **defect candidate** từ code + unit test; chưa repro trên browser/provider thật.

## BUG-033 — Đổi combo khi PAUSED bị bỏ qua

- **Severity:** Medium · **Priority:** P2 · **Status:** Open (candidate)
- **Related:** US-021 / AC-082 / BR-090, BR-108 / SCR-026 / TC-130
- **Reproduction:**
  1. Bật “Phối bộ”, chạy phiên, pause.
  2. Chọn món khác (UI cho phép vì `selectionLocked=false` khi paused).
  3. Bấm “Tiếp tục thử”.
- **Expected:** combo mới được áp dụng qua resume.
- **Actual:** `start()` chỉ tính `switchedProduct` khi `!outfitMode`; resume không gửi `productId` → BE dựng lại combo cũ.
- **Evidence:** `live-try-on-workspace.tsx:start:144-160`, `:316`; `use-live-try-on.ts:167-171`; `resumeSession` chỉ đổi khi có productId.
- **Root cause:** Nhánh resume dùng một sản phẩm, không hỗ trợ combo mới.

## BUG-034 — Worker để phiên PAUSED quá hạn ở trạng thái PAUSED

- **Severity:** Medium · **Priority:** P2 · **Status:** Open (candidate)
- **Related:** US-022, US-026 / AC-077 / BR-111 / SCR-026 / TC-118
- **Reproduction:** pause phiên, để quá `blockedUntil`, chạy worker, GET session.
- **Expected:** EXPIRED; UI không mời resume.
- **Actual:** chỉ ACTIVE → EXPIRED; PAUSED giữ nguyên dù reservation ALLOCATED, pauseExpiresAt đã qua.
- **Evidence:** `live-try-on.service.ts:settleExpiredSession:653-660`.
- **Root cause:** Điều kiện terminal chỉ xét ACTIVE.

## BUG-035 — Phiên PAUSED vẫn giữ slot concurrency

- **Severity:** Medium · **Priority:** P2 · **Status:** Open (candidate)
- **Related:** US-021, US-025 / AC-070, AC-073 / BR-096, BR-105 / SCR-026
- **Reproduction:** 5 user cùng pause; user thứ 6 bắt đầu.
- **Expected (plan §4.3):** slot xử lý được giải phóng khi đã xác nhận ngắt; resume kiểm tra slot.
- **Actual:** pause không xoá lease; concurrency đếm mọi lease; resume không kiểm tra lại slot.
- **Evidence:** `pauseSession:262-286` (không đụng lease); `reserveSessionTx:537-545`; `resumeSession:288-352`.
- **Root cause:** Một lease vừa giữ “một phiên/user” vừa bị dùng làm slot provider.

## BUG-036 — Tài liệu nói không đổi món, code + test cho phép

- **Severity:** Medium · **Priority:** P3 · **Status:** Open (documentation discrepancy)
- **Related:** US-021 / AC-082 / BR-108 / SCR-026 / TC-113
- **Expected:** theo `decart-lucy...:§7` và `quota-admin...:§4.2`, đổi món phải End rồi tạo phiên mới.
- **Actual:** `resumeSession` nhận `productId`, thay items; unit test “resumes … with another garment” khẳng định hành vi này.
- **Evidence:** `plans/decart-lucy-live-try-on-flow-and-business-rules.md:§7`; `plans/live-try-on-quota-admin-and-pause-plan.md:§4.2`; `live-try-on.service.ts:311-350`; spec:76.
- **Root cause:** Intent chưa được cập nhật sau khi combo/resume đổi món được triển khai.

## BUG-037 — Admin policy không chống ghi đè đồng thời

- **Severity:** Medium · **Priority:** P2 · **Status:** Open (candidate)
- **Related:** US-024 / AC-078 / BR-115 / SCR-027 / TC-124
- **Reproduction:** 2 admin cùng đọc version N; lưu lần lượt.
- **Expected:** người sau nhận conflict, buộc reload.
- **Actual:** `version=(dto.version ?? before.version)+1`, không so khớp; last-write-wins.
- **Evidence:** `admin-settings.service.ts:updateLiveTryOnSettings:80-86`.
- **Root cause:** Version chỉ để tăng, không dùng làm optimistic lock.

## BUG-038 — Beta allowlist không được enforce

- **Severity:** Medium · **Priority:** P2 · **Status:** Open (candidate)
- **Related:** US-019 / AC-064 / BR-116 / SCR-026 / TC-125
- **Expected:** plan §4: nếu allowlist không rỗng, product ngoài danh sách bị chặn.
- **Actual:** `resolveLiveProduct` không đọc/không kiểm tra allowlist.
- **Evidence:** `live-try-on.service.ts:resolveLiveProduct:678-690`; plan §4.
- **Root cause:** Rule chưa được implement hoặc đã bị bỏ mà không cập nhật docs.

## BUG-039 — Combo chỉ kiểm tra ảnh primary đọc được

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-020 / AC-064 / BR-085 / SCR-026
- **Expected:** mọi ảnh tham chiếu dùng trong phiên đều đọc được (hoặc chỉ primary theo thiết kế).
- **Actual:** `resolveLiveCombo` chỉ `assertGarmentUrlReadable(items[primaryIndex])`; ảnh món khác không được kiểm tra.
- **Evidence:** `live-try-on.service.ts:739`.
- **Root cause:** Prompt-only items không được coi là ảnh nguồn; rủi ro thấp nhưng không được tài liệu hoá.

## BUG-040 — Pause ghi reason vào `endedReason`

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-021 / AC-073 / BR-104 / SCR-026
- **Evidence:** `pauseSession:278` đặt `endedReason: reason ?? session.endedReason`.
- **Expected/Actual:** reason pause nên ở trường pause/audit riêng; `endedReason` bị nhiễu và có thể bị hiểu là lý do kết thúc.
- **Root cause:** Tái dùng cột session cho nhiều loại reason.

## BUG-041 — `prepareLiveOutfitReference` là dead code

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-020 / AC-081 / BR-088 / SCR-026 / TC-127…TC-129
- **Evidence:** function chỉ được test import (`tests/live-outfit-reference.test.cjs`); không có caller trong `src` (`grep prepareLiveOutfitReference src`).
- **Expected/Actual:** tính năng ghép 2 ảnh không còn được UI dùng; test pass tạo cảm giác cover flow nhưng không chứng minh đường người dùng.
- **Root cause:** Chuyển sang combo một ảnh primary + prompt nhưng không xoá module/test cũ.

## Tổng hợp

| Severity | Số | ID |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 6 | BUG-033…BUG-038 |
| Low | 3 | BUG-039…BUG-041 |
