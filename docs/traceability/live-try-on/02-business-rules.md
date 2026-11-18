# Business rules — FLW-003 (live try-on)

Luật dưới đây là hành vi BE/FE web. `Intended` lấy từ plan/provider docs; `Enforced` từ code. Các điểm lệch được đánh dấu và nối tới `06-defects.md`.

## Nhóm A — Eligibility, quota, policy

### BR-082 — Feature và tier do policy DB quyết định
- **Statement:** `enabled = settings.enabled && tierPolicy.liveEnabled`; tier lấy từ user, FREE/MEMBER/VIP có quota riêng.
- **Type:** Authorization
- **Condition:** Mọi request quota/create/resume.
- **Expected:** Tắt feature/tier → 403 `LIVE_TRYON_DISABLED`; quota trả `limit=0`.
- **Exception:** Chưa có bản ghi DB → fallback ENV có kiểm soát.
- **Related:** US-019, US-024 / AC-061, AC-067, AC-078
- **Enforcement point:** `live-try-on.service.ts:getPolicy:864-921`; `admin-settings.service.ts:getLiveTryOnSettings:71-78`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-083 — Quota là giây và tách khỏi quota ảnh
- **Statement:** `remaining = max(0, limit − reserved − allocated)`; `unit='seconds'`; quota ảnh/stylist không bị trừ.
- **Type:** Calculation
- **Condition:** Đọc quota.
- **Expected:** Feature tắt → limit 0, không dùng ngữ nghĩa lượt ảnh.
- **Exception:** Budget chưa tồn tại → reserved/allocated = 0.
- **Related:** US-023 / AC-061, AC-067
- **Enforcement point:** `getQuota:110-153`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-093

### BR-084 — Sản phẩm phải là UUID, ACTIVE, đúng category
- **Statement:** Chỉ nhận productId UUID; product tồn tại, `status=ACTIVE`, có `garmentUrl`, category nằm trong `allowedCategories`.
- **Type:** Validation
- **Condition:** Get garment/preview/create.
- **Expected:** `INVALID_PRODUCT_ID`, `LIVE_GARMENT_NOT_FOUND`, `LIVE_GARMENT_UNAVAILABLE`, `LIVE_GARMENT_CATEGORY_UNSUPPORTED`.
- **Exception:** Không có.
- **Related:** US-019, US-020 / AC-064
- **Enforcement point:** `resolveLiveProduct:678-690`; `getGarment:155-170`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-085 — Ảnh garment phải đọc được và là image
- **Statement:** BE fetch ảnh primary với timeout 10s, tối đa 8MB; content-type phải `image/*`.
- **Type:** Integration
- **Condition:** Trước khi tạo/resume.
- **Expected:** Lỗi → `LIVE_GARMENT_UNREADABLE` hoặc `LIVE_GARMENT_BAD_CONTENT_TYPE`.
- **Exception:** Chỉ kiểm tra ảnh primary của combo, không kiểm tra ảnh mô tả bằng prompt.
- **Related:** US-019 / AC-064
- **Enforcement point:** `assertGarmentUrlReadable:834-849`
- **Intended / Enforced:** yes / yes (partial cho combo)
- **Confidence:** High
- **Verification:** Code-verified

### BR-086 — Ảnh màu và chuẩn hoá ảnh
- **Statement:** Chọn ảnh theo `colorName`; màu yêu cầu không thuộc sản phẩm → `LIVE_GARMENT_COLOR_INVALID`; ảnh Cloudinary được trim/pad 1024 nền trắng.
- **Type:** Calculation
- **Condition:** Sản phẩm có `colors`/`images`.
- **Expected:** Fallback ảnh generic rồi `garmentUrl`; không chèn transformation hai lần.
- **Exception:** Sản phẩm không có màu nhưng client gửi màu → 400.
- **Related:** US-020 / AC-064
- **Enforcement point:** `resolveLiveGarment:692-722`; `garment-image.util.ts:buildCleanGarmentImageUrl:34-43`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-098, TC-099

### BR-087 — Luật ghép lớp combo
- **Statement:** Tối đa 3 món; mỗi `LayerRole` tối đa 1; FULL_BODY phải đứng riêng; ít nhất 1 món.
- **Type:** Constraint
- **Condition:** Tạo/preview/resume combo.
- **Expected:** 400 với message tương ứng.
- **Exception:** Single item luôn hợp lệ nếu sản phẩm hợp lệ.
- **Related:** US-020 / AC-065
- **Enforcement point:** `garment-combo.util.ts:layerCombinationError:17-38`; DTO `ArrayMaxSize(3)`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-088 — Chọn ảnh tham chiếu theo lớp
- **Statement:** Ưu tiên OUTER → FULL_BODY → INNER → BOTTOM; món primary giữ pixel, món khác chỉ vào prompt.
- **Type:** Calculation
- **Condition:** Combo nhiều món.
- **Expected:** `isPrimary` đúng một món; session lưu thứ tự.
- **Exception:** Không có.
- **Related:** US-020 / AC-066
- **Enforcement point:** `live-combo.util.ts:PRIMARY_PRIORITY:18-23`, `pickPrimaryIndex:46-54`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-102…TC-104

### BR-089 — Prompt combo một hành động, giới hạn 700 ký tự
- **Statement:** Prompt mô tả các lớp theo thứ tự OUTER → INNER → FULL_BODY → BOTTOM, một instruction duy nhất, cắt còn ≤700.
- **Type:** Calculation
- **Condition:** Tạo/resume/preview.
- **Expected:** Prompt không vượt giới hạn provider; không nêu chi tiết không có trong catalog.
- **Exception:** Prompt single dùng `buildPrompt` riêng, cũng ≤700.
- **Related:** US-020 / AC-066
- **Enforcement point:** `live-combo.util.ts:buildLiveComboPrompt:75-95`; `buildPrompt:900-920`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-105, TC-106

### BR-090 — Không đổi sản phẩm khi phiên đang ACTIVE
- **Statement:** UI khóa chọn món khi LIVE/busy; muốn đổi phải pause (theo UI) hoặc end.
- **Type:** Workflow
- **Condition:** Session ACTIVE.
- **Expected:** Garment slots disabled; BE từ chối resume nếu không PAUSED.
- **Exception:** Khi PAUSED, BE cho đổi món qua `productId` của resume (xem BR-109).
- **Related:** US-021 / AC-082
- **Enforcement point:** `live-try-on-workspace.tsx:selectionLocked:97`; `use-live-try-on.ts:updateGarment:218-221`
- **Intended / Enforced:** yes / partial
- **Confidence:** High
- **Verification:** Code-verified

### BR-091 — Idempotency key bắt buộc là UUID
- **Statement:** `Idempotency-Key` bắt buộc, đúng UUID; thiếu/sai → 400 `INVALID_IDEMPOTENCY_KEY`.
- **Type:** Validation
- **Condition:** POST sessions.
- **Expected:** Không tạo session/không gọi provider khi key sai.
- **Exception:** Không có.
- **Related:** US-019 / AC-069
- **Enforcement point:** `createSession:178-186`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-092 — Idempotency theo (user, key) + body hash
- **Statement:** Cùng key cùng body → không tạo mới, trả conflict trạng thái; cùng key khác body → `IDEMPOTENCY_BODY_MISMATCH`.
- **Type:** Consistency
- **Condition:** Retry create.
- **Expected:** Không mint credential thứ hai.
- **Exception:** body hash phụ thuộc thứ tự items.
- **Related:** US-019 / AC-069
- **Enforcement point:** `createSession:187-205`; `hashJson`; prisma unique `userId_idempotencyKey`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-108

### BR-093 — Credential chỉ trả một lần
- **Statement:** Token không lưu DB; chỉ trả trong response create/resume đầu tiên; status không chứa token.
- **Type:** Integration
- **Condition:** Create/resume/get.
- **Expected:** Retry không replay token; `providerMetadata` đã redact token.
- **Exception:** Không có.
- **Related:** US-025 / AC-072, AC-083
- **Enforcement point:** `createSession:220-256`; `decart-realtime.service.ts:redactTokenFields:100-102`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-094 — Một lease active mỗi user
- **Statement:** Nếu lease còn `expiresAt > now`, create trả `409 LIVE_SESSION_ACTIVE` kèm `blockedUntil`.
- **Type:** Constraint
- **Condition:** Tạo session mới.
- **Expected:** Không reserve thêm.
- **Exception:** Lease hết hạn được thay thế bằng upsert.
- **Related:** US-019 / AC-063
- **Enforcement point:** `createSession:206-209`; `LiveTryOnLease.userId @unique`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-095 — `blockedUntil` gồm TTL + phiên + grace + pause timeout
- **Statement:** `blockedUntil = now + tokenTtl + maxDuration + grace + pauseTimeout`.
- **Type:** Calculation
- **Condition:** Tạo session.
- **Expected:** Lease sống đủ lâu cho pause/resume; worker chỉ settle sau mốc này.
- **Exception:** Plan cũ chỉ mô tả TTL + duration + grace (tài liệu stale).
- **Related:** US-019, US-022 / AC-068, AC-076
- **Enforcement point:** `createSession:210-212`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-096 — Giới hạn phiên đồng thời toàn hệ thống
- **Statement:** Đếm lease còn hiệu lực; `>= maxConcurrentSessions` → `403 LIVE_CONCURRENCY_EXCEEDED`.
- **Type:** Constraint
- **Condition:** Reserve.
- **Expected:** Fail closed, không gọi provider.
- **Exception:** Không có.
- **Related:** US-025 / AC-070
- **Enforcement point:** `reserveSessionTx:537-545`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-111

### BR-097 — Ngân sách phiên = min(trần, user còn, global còn)
- **Statement:** `sessionBudgetSeconds = min(maxDurationSeconds, userRemaining, globalRemaining)`; dưới `DECART_LIVE_MIN_SESSION_SECONDS` (mặc định 5) → 403.
- **Type:** Calculation
- **Condition:** Reserve.
- **Expected:** Phiên ngắn vẫn được cấp nếu đủ mức tối thiểu.
- **Exception:** Số dư 0 → quota/concurrency error tương ứng.
- **Related:** US-019 / AC-061, AC-068
- **Enforcement point:** `reserveSessionTx:547-572`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-098 — Reserve nguyên tử
- **Statement:** Reserve user + global + tạo session + lease trong transaction Serializable, retry P2034 tối đa 3 lần.
- **Type:** Consistency
- **Condition:** Create.
- **Expected:** Không có trạng thái nửa vời khi lỗi.
- **Exception:** Retry cạn → trả lỗi gốc.
- **Related:** US-019 / AC-068
- **Enforcement point:** `reserveSession:512-535`; `withSerializableRetry:664-676`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-099 — Quota gắn ngày Việt Nam tại lúc reserve
- **Statement:** `quotaDate = ngày UTC+7`; resume/qua nửa đêm không đổi bucket; resetAt nửa đêm VN.
- **Type:** Calculation
- **Condition:** Create.
- **Expected:** Settle về đúng bucket ngày tạo.
- **Exception:** Không có.
- **Related:** US-022 / AC-076
- **Enforcement point:** `reserveSessionTx:560`; `quotaDateKey`/`nextQuotaReset` (utils)
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-100 — Global budget quy đổi từ giây, snapshot rate
- **Statement:** Global dùng `globalDailySeconds`; mỗi phiên lưu `rateCreditsPerSecond` để đối soát chi phí.
- **Type:** Calculation
- **Condition:** Create.
- **Expected:** Không trộn credits với giây ở ledger.
- **Exception:** Policy cũ có `globalDailyCredits` được quy đổi một lần.
- **Related:** US-024 / AC-078
- **Enforcement point:** `getPolicy:864-921`; `admin-settings.service.ts:resolveGlobalDailySeconds:214-225`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-101 — Token yêu cầu giới hạn model/origin/duration
- **Statement:** Token gửi `allowedModels=[model]`, `allowedOrigins=[origin]` nếu có, `constraints.realtime.maxSessionDuration`.
- **Type:** Integration
- **Condition:** Mint token.
- **Expected:** Token không dùng được cho model/khác origin; max duration = budget phiên.
- **Exception:** Không có Origin → bỏ `allowedOrigins`.
- **Related:** US-025 / AC-083
- **Enforcement point:** `decart-realtime.service.ts:createClientToken:56-73`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-102 — API key chỉ ở BE, fail closed
- **Statement:** Thiếu `DECART_API_KEY` → 503 `DECART_NOT_CONFIGURED`; không gọi provider.
- **Type:** Authorization
- **Condition:** Provider=decart.
- **Expected:** Không lộ secret ra client/log.
- **Exception:** Provider=mock chỉ dùng dev.
- **Related:** US-025 / AC-083
- **Enforcement point:** `decart-realtime.service.ts:52-54`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-103 — Provider lỗi phải release reservation
- **Statement:** Nếu mint token lỗi, session FAILED, reservation RELEASED, budget hoàn, lease xoá.
- **Type:** Error handling
- **Condition:** Decart lỗi/timeout.
- **Expected:** Không giữ quota cho phiên không có token.
- **Exception:** Nếu release cũng lỗi → transaction rollback, cần đối soát.
- **Related:** US-025 / AC-071
- **Enforcement point:** `createSession:230-238`; `releaseFailedReservation:619-638`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-112

## Nhóm B — Pause / resume / end

### BR-104 — Pause chỉ từ ACTIVE và idempotent
- **Statement:** Pause session khác ACTIVE trả nguyên trạng thái; ACTIVE → PAUSED, chốt used, set pauseExpiresAt, revision+1.
- **Type:** State
- **Condition:** Gọi pause.
- **Expected:** Không trừ thêm thời gian khi pause lặp.
- **Exception:** Không sở hữu → 404.
- **Related:** US-021 / AC-073
- **Enforcement point:** `pauseSession:262-286`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-105 — Pause giữ lease và slot
- **Statement:** Pause không xoá lease, không giảm concurrency; slot bị giữ tới `blockedUntil`.
- **Type:** Constraint
- **Condition:** PAUSED.
- **Expected (code):** User khác có thể bị `LIVE_CONCURRENCY_EXCEEDED` bởi phiên pause.
- **Exception:** Plan §4.3 nói giải phóng slot khi đã ngắt → lệch intent.
- **Related:** US-021, US-025 / AC-073, AC-070
- **Enforcement point:** `pauseSession` không đụng `liveTryOnLease`; `reserveSessionTx:537` đếm mọi lease
- **Intended / Enforced:** no / yes (giữ slot)
- **Confidence:** High
- **Verification:** Code-verified → BUG-035

### BR-106 — Resume chỉ khi PAUSED, còn hạn, còn giây
- **Statement:** Owner + status PAUSED; `pauseExpiresAt > now`; `remaining > 0`; feature/tier còn hiệu lực.
- **Type:** State
- **Condition:** Resume.
- **Expected:** 409 `LIVE_SESSION_NOT_PAUSED` / `LIVE_PAUSE_EXPIRED` / `LIVE_SESSION_EXHAUSTED`.
- **Exception:** Không sở hữu → 404.
- **Related:** US-021 / AC-074
- **Enforcement point:** `resumeSession:288-308`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-113

### BR-107 — Resume không reserve thêm
- **Statement:** Resume chỉ mint token/update session; không tăng reserved user/global, không tạo lease mới.
- **Type:** Consistency
- **Condition:** Resume.
- **Expected:** `remainingSeconds` tiếp tục từ budget cũ.
- **Exception:** Đổi món vẫn dùng budget cũ.
- **Related:** US-021 / AC-075
- **Enforcement point:** `resumeSession:309-352`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-113

### BR-108 — Resume đổi món chỉ khi pause
- **Statement:** Nếu client gửi `productId`, BE resolve combo mới, thay toàn bộ items, vẫn dùng budget cũ.
- **Type:** Workflow
- **Condition:** Resume có `productId`.
- **Expected:** Sản phẩm mới phải hợp lệ; primary mới được lưu.
- **Exception:** Plan §4.2 nói đổi món bị tắt → lệch tài liệu; code + test cho phép.
- **Related:** US-021 / AC-082
- **Enforcement point:** `resumeSession:311-350`; test `resumes a paused session with another garment...`
- **Intended / Enforced:** no (theo plan) / yes
- **Confidence:** High
- **Verification:** Code-verified → BUG-036

### BR-109 — End quyết toán đúng used, hoàn phần chưa dùng
- **Statement:** End tính `usedSeconds` (ceil giây active), chuyển reserved→allocated=used, xoá lease, set ENDED.
- **Type:** Calculation
- **Condition:** End.
- **Expected:** Phần reserved chưa dùng được hoàn; không settle lần hai.
- **Exception:** End lặp: reservation đã ALLOCATED → bỏ qua budget update.
- **Related:** US-022 / AC-076
- **Enforcement point:** `endSession:354-405`; `computeUsedSeconds:446-449`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-110 — Worker settle phiên RESERVED quá hạn
- **Statement:** Cron mỗi phút, tối đa 50 phiên, chỉ RESERVED + `blockedUntil<=now` + credential ISSUING/ISSUED/ISSUE_UNKNOWN.
- **Type:** Consistency
- **Condition:** Worker chạy.
- **Expected:** ALLOCATED, lease xoá, ISSUING → ISSUE_UNKNOWN, ACTIVE → EXPIRED.
- **Exception:** Missing migration → log một lần, bỏ qua.
- **Related:** US-026 / AC-077
- **Enforcement point:** `reconcileExpiredSessions:476-510`; `settleExpiredSession:641-662`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified + TC-126

### BR-111 — Worker không đổi PAUSED thành EXPIRED
- **Statement:** Khi settle phiên PAUSED quá hạn, status giữ PAUSED (chỉ ACTIVE → EXPIRED).
- **Type:** State
- **Condition:** PAUSED hết `blockedUntil`.
- **Expected (intent):** Phiên phải terminal (EXPIRED) và UI không mời resume.
- **Exception:** Code giữ PAUSED dù reservation ALLOCATED, pauseExpiresAt đã qua.
- **Related:** US-022, US-026 / AC-077
- **Enforcement point:** `settleExpiredSession:653-660`
- **Intended / Enforced:** yes / no
- **Confidence:** High
- **Verification:** Code-verified → BUG-034

### BR-112 — Ownership cho mọi thao tác session
- **Statement:** get/pause/resume/end chỉ thao tác session của user; không tìm thấy hoặc khác owner → 404.
- **Type:** Authorization
- **Condition:** Mọi API session.
- **Expected:** Không lộ session tồn tại của user khác.
- **Exception:** Không có.
- **Related:** US-019…US-022 / AC-068, AC-073, AC-074, AC-076
- **Enforcement point:** `getSession:254-260`; `pauseSession:263-268`; `resumeSession:290-296`; `endSession:354-360`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

## Nhóm C — Admin, policy, catalog

### BR-113 — Admin settings có version và audit
- **Statement:** PUT lưu `app_settings`, tăng version, ghi audit before/after/actor/reason trong cùng transaction.
- **Type:** Consistency
- **Condition:** Admin lưu.
- **Expected:** `source=database`; audit tồn tại.
- **Exception:** Thiếu bảng audit → transaction fail.
- **Related:** US-024 / AC-078, AC-084
- **Enforcement point:** `admin-settings.service.ts:updateLiveTryOnSettings:80-100`; `live_try_on_policy_audits`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-114 — Validate policy đầu vào
- **Statement:** DTO giới hạn daily 0…86400, max session 0…3600, concurrent 1…100, pause 15…86400, category ∈ UPPER/LOWER/FULL_BODY, reason/version optional.
- **Type:** Validation
- **Condition:** PUT settings.
- **Expected:** 400 nếu ngoài biên.
- **Exception:** Relation `maxSessionSeconds <= dailySeconds` chỉ FE kiểm tra; BE không.
- **Related:** US-024 / AC-078
- **Enforcement point:** `live-try-on-settings.dto.ts:5-72`; `admin-live-try-on-settings-panel.tsx:90-101`
- **Intended / Enforced:** yes / partial
- **Confidence:** High
- **Verification:** Code-verified

### BR-115 — Version không chống ghi đè đồng thời
- **Statement:** `version = (dto.version ?? before.version) + 1`; không so khớp version client với DB trước khi ghi.
- **Type:** Consistency
- **Condition:** Hai admin lưu gần nhau.
- **Expected (intent):** Admin thứ hai nhận conflict và phải reload.
- **Exception:** Last-write-wins; audit vẫn ghi cả hai.
- **Related:** US-024 / AC-078
- **Enforcement point:** `admin-settings.service.ts:80-86`
- **Intended / Enforced:** no / no
- **Confidence:** High
- **Verification:** Code-verified → BUG-037

### BR-116 — Beta allowlist được tài liệu nhưng không enforce
- **Statement:** Plan nói nếu `DECART_LIVE_BETA_PRODUCT_IDS` không rỗng thì product phải nằm trong allowlist.
- **Type:** Constraint
- **Condition:** Product eligibility.
- **Expected:** Product ngoài allowlist bị 403/400.
- **Exception:** Code không đọc biến/allowlist này.
- **Related:** US-019 / AC-064
- **Enforcement point:** `resolveLiveProduct:678-690` (không có nhánh allowlist); plan §4
- **Intended / Enforced:** yes / no
- **Confidence:** High
- **Verification:** Code-verified → BUG-038

### BR-117 — Policy chỉ ảnh hưởng phiên mới
- **Statement:** Session lưu snapshot `policyVersion`, `tier`, `rateCreditsPerSecond`; đổi policy không sửa phiên đang chạy.
- **Type:** Consistency
- **Condition:** Admin đổi policy.
- **Expected:** Phiên cũ giữ quota/trần đã reserve; phiên mới dùng policy mới.
- **Exception:** Resume dùng policy hiện tại để check enabled/tier, nhưng không đổi budget.
- **Related:** US-024 / AC-078
- **Enforcement point:** `reserveSessionTx:573-590`; `resumeSession:296`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified
