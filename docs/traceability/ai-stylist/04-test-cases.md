# Test cases — FLW-004 (AI Stylist)

`Status` chỉ `PASS` khi có `EXEC` tương ứng trong `05-execution.md`. Test chạy là Jest unit/e2e BE (mock Prisma/Gemini) và `node:test` FE; không có browser, Postgres, Redis hay Gemini thật.

## TS-021 — Truy cập & quota

### TC-131 — FREE được 3 lượt STYLIST/ngày
- **Related:** US-027 / AC-085 / BR-119 / SCR-028
- **Type:** Boundary · **Priority:** P0
- **Preconditions:** Redis mock; `daily_usages` count = 2.
- **Test data:** user FREE, action STYLIST.
| # | Action | Expected result |
|---|---|---|
| 1 | `assertQuota` với count=1 | Cho phép khi used=2 |
| 2 | used=3 | 429 `QUOTA_EXCEEDED`, `remaining=0` |
- **Expected:** biên 2→3 đúng; key `quota:stylist:<user>:<date>`.
- **Automation:** Yes · **Status:** PASS (EXEC-062)

### TC-132 — MEMBER 20, VIP không giới hạn
- **Related:** US-027 / AC-085 / BR-119
- **Type:** Boundary · **Priority:** P1
- **Preconditions:** tier MEMBER/VIP.
| # | Action | Expected result |
|---|---|---|
| 1 | MEMBER used=19 | Cho phép |
| 2 | MEMBER used=20 | 429 |
| 3 | VIP used=10000 | Cho phép, không đọc counter |
- **Expected:** đúng bảng limit; VIP short-circuit.
- **Automation:** Yes · **Status:** Not Run

### TC-133 — Guard chặn trước provider
- **Related:** US-027 / AC-085, AC-086 / BR-119, BR-120
- **Type:** Negative · **Priority:** P0
- **Preconditions:** QuotaGuard với quota đã hết; controller spy.
| # | Action | Expected result |
|---|---|---|
| 1 | Gọi route analyze | 429 `QUOTA_EXCEEDED` |
| 2 | Kiểm tra spy `analyzeAndAdvise` | Không được gọi |
- **Expected:** không có request Gemini, không trừ quota.
- **Automation:** Yes · **Status:** PASS (EXEC-063)

### TC-134 — Thiếu API key trả 503
- **Related:** US-027 / AC-087 / BR-122
- **Type:** Error · **Priority:** P1
- **Preconditions:** `GEMINI_API_KEY` rỗng.
| # | Action | Expected result |
|---|---|---|
| 1 | Gọi `analyzeAndAdvise` | 503 `GEMINI_NOT_CONFIGURED` |
| 2 | Kiểm tra create/consume | Không gọi |
- **Expected:** không lưu row, không trừ lượt.
- **Automation:** Yes · **Status:** PASS (EXEC-064)

### TC-135 — Không có ngữ cảnh nào
- **Related:** US-027 / AC-105 / BR-123
- **Type:** Validation · **Priority:** P0
- **Preconditions:** Không ảnh, không product, mọi text rỗng.
| # | Action | Expected result |
|---|---|---|
| 1 | Analyze | 400 BadRequest |
| 2 | Kiểm tra Gemini | Không gọi |
- **Expected:** message yêu cầu ít nhất một thông tin.
- **Automation:** Yes · **Status:** PASS (EXEC-065)

### TC-175 — Thiếu JWT bị 401
- **Related:** US-027 / BR-118 / SCR-028
- **Type:** Auth · **Priority:** P0
- **Preconditions:** Không token.
| # | Action | Expected result |
|---|---|---|
| 1 | POST /stylist/analyze | 401 `UNAUTHORIZED` |
| 2 | GET /stylist/history | 401 |
- **Expected:** không lộ dữ liệu; middleware FE chuyển login.
- **Automation:** Yes · **Status:** Not Run

## TS-022 — Consent & ảnh

### TC-136 — Ảnh không consent (unit)
- **Related:** US-028 / AC-089 / BR-124
- **Type:** Negative · **Priority:** P0
- **Preconditions:** File ảnh hợp lệ; `imageConsent` undefined.
| # | Action | Expected result |
|---|---|---|
| 1 | Analyze | 400 |
| 2 | Gemini spy | Không gọi |
- **Expected:** không lưu hash/row.
- **Automation:** Yes · **Status:** PASS (EXEC-066)

### TC-137 — Consent `'false'` qua HTTP
- **Related:** US-028 / AC-089 / BR-124, BR-125
- **Type:** Negative · **Priority:** P0
- **Preconditions:** e2e Nest app; multipart.
| # | Action | Expected result |
|---|---|---|
| 1 | Gửi ảnh + `imageConsent='false'` | 400 |
| 2 | Gửi ảnh + thiếu field | 400 |
| 3 | Gemini spy | Không gọi |
- **Expected:** parse consent nghiêm ngặt.
- **Automation:** Yes · **Status:** PASS (EXEC-067)

### TC-138 — File sai MIME
- **Related:** US-028 / AC-091 / BR-126
- **Type:** Validation · **Priority:** P1
- **Preconditions:** File `text/plain`.
| # | Action | Expected result |
|---|---|---|
| 1 | Upload | 400 từ `FileValidationPipe` |
- **Expected:** không gọi service.
- **Automation:** Yes · **Status:** PASS (EXEC-068)

### TC-139 — File >10 MB
- **Related:** US-028 / AC-091 / BR-126
- **Type:** Boundary · **Priority:** P2
- **Preconditions:** Buffer 10 MB + 1 byte, MIME jpeg.
| # | Action | Expected result |
|---|---|---|
| 1 | Upload | 400 |
| 2 | Buffer đúng 10 MB | Qua validation |
- **Expected:** biên chính xác.
- **Automation:** Yes · **Status:** Not Run

### TC-140 — Ảnh không lưu, chỉ hash
- **Related:** US-028 / AC-090 / BR-127
- **Type:** Positive · **Priority:** P0
- **Preconditions:** Ảnh + consent true.
| # | Action | Expected result |
|---|---|---|
| 1 | Analyze thành công | 200 `hasImage=true`, `humanImageUrl=null` |
| 2 | Kiểm tra row | `humanImageHash` là SHA-256; `imageConsentAt` có |
- **Expected:** không bytes/URL ảnh trong DB.
- **Automation:** Yes · **Status:** PASS (EXEC-069)

## TS-023 — Sản phẩm neo & catalog

### TC-141 — Product không tồn tại
- **Related:** US-029 / AC-092 / BR-128
- **Type:** Negative · **Priority:** P1
- **Preconditions:** UUID hợp lệ nhưng không có row.
| # | Action | Expected result |
|---|---|---|
| 1 | Analyze | 404 |
| 2 | Gemini/consume | Không gọi |
- **Expected:** không tạo row.
- **Automation:** Yes · **Status:** PASS (EXEC-070)

### TC-142 — ProductId sai UUID
- **Related:** US-029 / AC-092 / BR-128
- **Type:** Validation · **Priority:** P2
- **Preconditions:** `productId='abc'`.
| # | Action | Expected result |
|---|---|---|
| 1 | POST | 400 `VALIDATION_ERROR` |
- **Expected:** DTO chặn trước service.
- **Automation:** Yes · **Status:** Not Run

### TC-143 — Catalog ACTIVE + mã Pn
- **Related:** US-031 / AC-095 / BR-129
- **Type:** Positive · **Priority:** P0
- **Preconditions:** Có ACTIVE, INACTIVE, sản phẩm không ảnh.
| # | Action | Expected result |
|---|---|---|
| 1 | `getCatalog` | Chỉ ACTIVE, mã P1..Pn |
| 2 | Prompt line | code/name/type/layer/gender/colors/material/price |
- **Expected:** không lộ sản phẩm ngừng bán.
- **Automation:** Yes · **Status:** PASS (EXEC-071)

### TC-144 — Lọc giới tính
- **Related:** US-030 / AC-094 / BR-130
- **Type:** Positive · **Priority:** P1
- **Preconditions:** Catalog nam/nữ/unisex.
| # | Action | Expected result |
|---|---|---|
| 1 | `getCatalog(MALE)` | Nam + unisex, không nữ |
| 2 | Prompt | Có câu "chỉ gồm đồ nam và đồ unisex" |
- **Expected:** mã đánh lại từ P1.
- **Automation:** Yes · **Status:** PASS (EXEC-072)

### TC-145 — Outfit phải chứa món neo
- **Related:** US-029 / AC-093 / BR-131
- **Type:** Positive · **Priority:** P1
- **Preconditions:** Gemini trả 2 outfit, 1 không chứa blazer.
| # | Action | Expected result |
|---|---|---|
| 1 | Analyze với productId blazer | Chỉ giữ outfit chứa blazer |
- **Expected:** prompt có chỉ dẫn mã neo.
- **Automation:** Yes · **Status:** PASS (EXEC-073)

### TC-146 — Mã bịa bị loại
- **Related:** US-031 / AC-095 / BR-132
- **Type:** Negative · **Priority:** P0
- **Preconditions:** Response chứa P90/P91.
| # | Action | Expected result |
|---|---|---|
| 1 | Resolve | Outfit chứa mã lạ bị loại |
| 2 | Response | Chỉ sản phẩm thật |
- **Expected:** không có sản phẩm ảo.
- **Automation:** Yes · **Status:** PASS (EXEC-074)

### TC-147 — Cấu trúc outfit (phần đã cài đặt)
- **Related:** US-031 / AC-096 / BR-133
- **Type:** Validation · **Priority:** P1
- **Preconditions:** Các bộ: 1 dress; top+bottom; 1 áo lẻ; outfit trùng mã.
| # | Action | Expected result |
|---|---|---|
| 1 | Resolve | Giữ dress đơn và top+bottom; bỏ outfit 1 áo không phải dress; dedupe mã |
| 2 | Role | Chuẩn hoá `top|bottom|outer|dress`; giữ thứ tự |
- **Expected:** các kiểm tra hiện có hoạt động; **không** khẳng định dress+quần bị loại (xem TC-176).
- **Automation:** Yes · **Status:** PASS (EXEC-075)

### TC-148 — Giá chỉ tính món available
- **Related:** US-031 / AC-097 / BR-134
- **Type:** Calculation · **Priority:** P0
- **Preconditions:** 1 món hết hàng trong outfit.
| # | Action | Expected result |
|---|---|---|
| 1 | Build outfit | `totalPrice` bỏ món hết hàng |
| 2 | Response | Item vẫn `available=false` |
- **Expected:** số tiền khớp tổng tay.
- **Automation:** Yes · **Status:** PASS (EXEC-076)

## TS-024 — Lưu, cache, response

### TC-149 — Lưu đầy đủ + trừ 1 quota
- **Related:** US-027, US-032 / AC-087, AC-098 / BR-120, BR-139, BR-148
- **Type:** Positive · **Priority:** P0
- **Preconditions:** Gemini trả JSON hợp lệ.
| # | Action | Expected result |
|---|---|---|
| 1 | Analyze | `stylistResult.create` đúng payload |
| 2 | Kiểm tra `inputContext` | product/occasion/budget/gender/hasImage/consent/catalog |
| 3 | `consumeQuota` | Gọi đúng 1 lần |
- **Expected:** response có `id`, `outfits`, `verdict`.
- **Automation:** Yes · **Status:** PASS (EXEC-077)

### TC-150 — Cache hit miễn phí
- **Related:** US-027, US-032 / AC-088, AC-099 / BR-121, BR-142
- **Type:** Positive · **Priority:** P0
- **Preconditions:** Row cache còn hạn.
| # | Action | Expected result |
|---|---|---|
| 1 | Analyze lại | `isCached=true` |
| 2 | Gemini/consume | Không gọi |
| 3 | Outfit | Hydrate tên sản phẩm |
- **Expected:** 0 chi phí.
- **Automation:** Yes · **Status:** PASS (EXEC-078)

### TC-151 — Cache hết hạn
- **Related:** US-032 / AC-099 / BR-141
- **Type:** Boundary · **Priority:** P2
- **Preconditions:** `expiresAt = now - 1s`.
| # | Action | Expected result |
|---|---|---|
| 1 | Analyze | Cache miss; gọi Gemini; tạo row mới |
- **Expected:** row cũ không bị dùng.
- **Automation:** Yes · **Status:** Not Run

### TC-152 — Cache key đổi theo input/catalog
- **Related:** US-032 / AC-099 / BR-140
- **Type:** Positive · **Priority:** P1
- **Preconditions:** Catalog đổi gender một sản phẩm.
| # | Action | Expected result |
|---|---|---|
| 1 | So fingerprint | Khác nhau |
| 2 | Đổi occasion | Key khác |
- **Expected:** không trả nhầm kết quả.
- **Automation:** Yes · **Status:** PASS (EXEC-079)

### TC-153 — Hydrate response
- **Related:** US-032 / AC-100 / BR-145
- **Type:** Positive · **Priority:** P0
- **Preconditions:** Row có outfits mã sản phẩm.
| # | Action | Expected result |
|---|---|---|
| 1 | Analyze/cache hit | Top-level `outfits` có product name/price/image |
- **Expected:** dữ liệu hiện tại, không phải snapshot cũ.
- **Automation:** Yes · **Status:** PASS (EXEC-080)

## TS-025 — Parse & lỗi provider

### TC-154 — Strip markdown fence
- **Related:** US-031 / AC-095 / BR-135
- **Type:** Positive · **Priority:** P1
- **Preconditions:** Output ```` ```json {...} ``` ````.
| # | Action | Expected result |
|---|---|---|
| 1 | `parseRawResponse` | Object JSON |
| 2 | Output không có JSON | Throw |
- **Expected:** parse an toàn.
- **Automation:** Yes · **Status:** PASS (EXEC-081)

### TC-155 — Thiếu field bắt buộc
- **Related:** US-031 / AC-095 / BR-136
- **Type:** Validation · **Priority:** P1
- **Preconditions:** Thiếu `fitRecommendation`.
| # | Action | Expected result |
|---|---|---|
| 1 | `validateResult` | Throw `/thiếu field/` |
- **Expected:** không trả kết quả dở.
- **Automation:** Yes · **Status:** PASS (EXEC-082)

### TC-156 — Clamp & normalize
- **Related:** US-031 / AC-097 / BR-136
- **Type:** Boundary · **Priority:** P2
- **Preconditions:** score 150; màu dạng object/string.
| # | Action | Expected result |
|---|---|---|
| 1 | Validate | score=100 |
| 2 | Color | object `{name,hex:null}`; outfitCombinations stringify |
- **Expected:** kiểu dữ liệu ổn định.
- **Automation:** Yes · **Status:** PASS (EXEC-083)

### TC-157 — Hex màu hợp lệ
- **Related:** US-031 / BR-136
- **Type:** Validation · **Priority:** P2
- **Preconditions:** `#e8dcc8`, `red`, entry không tên.
| # | Action | Expected result |
|---|---|---|
| 1 | Validate | `#E8DCC8`; `red`→null; entry không tên bị bỏ |
- **Expected:** không render mã màu sai.
- **Automation:** Yes · **Status:** PASS (EXEC-084)

### TC-158 — Gemini 429 → 429
- **Related:** US-027 / AC-086 / BR-138
- **Type:** Error · **Priority:** P1
- **Preconditions:** Provider throw quota/429.
| # | Action | Expected result |
|---|---|---|
| 1 | Analyze | HttpException 429 |
- **Expected:** không lưu row/trừ quota.
- **Automation:** Yes · **Status:** PASS (EXEC-085)

### TC-159 — Repair một lần
- **Related:** US-031 / BR-137
- **Type:** Integration · **Priority:** P2
- **Preconditions:** Lần 1 trả JSON hỏng, lần 2 hợp lệ.
| # | Action | Expected result |
|---|---|---|
| 1 | Generate | Gọi provider đúng 2 lần |
| 2 | Lần 2 vẫn hỏng | 502, không gọi lần 3 |
- **Expected:** prompt repair chứa lý do + 2000 ký tự.
- **Automation:** Yes · **Status:** Not Run

### TC-160 — Lỗi provider khác → 500/502
- **Related:** US-027 / BR-138
- **Type:** Error · **Priority:** P2
- **Preconditions:** API key sai; lỗi mạng; output rỗng.
| # | Action | Expected result |
|---|---|---|
| 1 | Analyze | 401 `INVALID_API_KEY` / 500 `GEMINI_ERROR` / 502 `GEMINI_INVALID_RESPONSE` |
- **Expected:** mã ổn định; không lộ stack.
- **Automation:** Yes · **Status:** Not Run

## TS-026 — Lịch sử

### TC-161 — Phân trang & meta
- **Related:** US-033 / AC-101 / BR-143, BR-144
- **Type:** Boundary · **Priority:** P1
- **Preconditions:** 25 rows.
| # | Action | Expected result |
|---|---|---|
| 1 | page=1 limit=5 | 5 item mới nhất; totalPages=5 |
| 2 | limit=1000 | Kẹp 100 |
| 3 | page=0/-1/'abc' | Kỳ vọng 400 (hiện có thể 500 — BUG-051) |
- **Expected:** không lộ row ngoài user.
- **Automation:** Yes · **Status:** Not Run

### TC-162 — List hydrate một query
- **Related:** US-033 / AC-102 / BR-145
- **Type:** Integration · **Priority:** P1
- **Preconditions:** 2 item, một item legacy.
| # | Action | Expected result |
|---|---|---|
| 1 | `getUserHistory` | `product.findMany` đúng 1 lần |
| 2 | Item | `outfits` được ghép; legacy `outfits=[]` |
- **Expected:** không N+1.
- **Automation:** Yes · **Status:** PASS (EXEC-086)

### TC-163 — Detail của người khác
- **Related:** US-033 / AC-103 / BR-142, BR-146
- **Type:** Auth · **Priority:** P0
- **Preconditions:** Row thuộc user B.
| # | Action | Expected result |
|---|---|---|
| 1 | User A GET /history/:id | 404 |
| 2 | User A DELETE | 404 |
- **Expected:** không phân biệt "không có" và "không sở hữu".
- **Automation:** Yes · **Status:** Not Run

### TC-164 — Delete hard
- **Related:** US-033 / AC-104 / BR-147
- **Type:** Positive · **Priority:** P1
- **Preconditions:** Row của user.
| # | Action | Expected result |
|---|---|---|
| 1 | DELETE | 200 `data:null` |
| 2 | GET list | Không còn row |
- **Expected:** row bị xoá khỏi DB.
- **Automation:** Yes · **Status:** Not Run

## TS-027 — Web FE

### TC-165 — Validate form thiếu ngữ cảnh
- **Related:** US-034 / AC-105 / BR-149
- **Type:** Validation · **Priority:** P1
- **Preconditions:** Mọi field rỗng.
| # | Action | Expected result |
|---|---|---|
| 1 | `validateStylistRequest` | Trả message yêu cầu ảnh/sản phẩm/dịp/phong cách |
| 2 | Có occasion | null (hợp lệ) |
- **Expected:** khớp BE (budget không tính).
- **Automation:** Yes · **Status:** PASS (EXEC-087)

### TC-166 — Ảnh thiếu consent trên FE
- **Related:** US-034 / AC-106 / BR-149
- **Type:** Validation · **Priority:** P0
- **Preconditions:** photoFile có, consent false.
| # | Action | Expected result |
|---|---|---|
| 1 | Validate | Message xác nhận |
| 2 | Photo + consent | null |
- **Expected:** không gửi request.
- **Automation:** Yes · **Status:** PASS (EXEC-088)

### TC-167 — FormData consent đúng điều kiện
- **Related:** US-034 / AC-106 / BR-150
- **Type:** Positive · **Priority:** P1
- **Preconditions:** Có/không ảnh.
| # | Action | Expected result |
|---|---|---|
| 1 | Không ảnh | Không có field `imageConsent` |
| 2 | Có ảnh + consent | `imageConsent='true'` |
| 3 | Có ảnh không consent | Không gửi field → BE 400 |
- **Expected:** không gửi consent mồ côi.
- **Automation:** Yes · **Status:** PASS (EXEC-089)

### TC-168 — Timeout analyze 90 s
- **Related:** US-034 / AC-107 / BR-151
- **Type:** Integration · **Priority:** P3
- **Preconditions:** Kiểm tra config `http.post` hoặc mock timer.
| # | Action | Expected result |
|---|---|---|
| 1 | Gọi analyze | Nhận `timeout: 90000` |
| 2 | Sau 90 s | UI báo lỗi; server vẫn có thể hoàn tất |
- **Expected:** không treo vô hạn.
- **Automation:** No (config assertion) · **Status:** Not Run

### TC-169 — Modal quota
- **Related:** US-034 / AC-107 / BR-152
- **Type:** Workflow · **Priority:** P1
- **Preconditions:** Component test (chưa có RTL).
| # | Action | Expected result |
|---|---|---|
| 1 | quota remaining=0, bấm Gửi | Không gọi analyze; modal mở |
| 2 | Analyze trả 429 | Modal mở |
| 3 | 429 có `remaining/resetAt` | Modal hiển thị đúng số liệu (hiện chưa — BUG-045) |
- **Expected:** người dùng thấy lý do và CTA.
- **Automation:** No · **Status:** Not Run

### TC-170 — Deep link & xoá kết quả đang chọn
- **Related:** US-034 / AC-108 / BR-153, BR-154
- **Type:** Workflow · **Priority:** P2
- **Preconditions:** URL `?result=<id>`; mock fetch.
| # | Action | Expected result |
|---|---|---|
| 1 | Mount | Gọi GET detail, hiện result |
| 2 | Xoá result đang chọn | Về idle; URL bỏ `result` |
- **Expected:** reload không mất kết quả.
- **Automation:** No · **Status:** Not Run

### TC-171 — Outfit → thử đồ
- **Related:** US-034 / AC-108 / BR-155
- **Type:** Positive · **Priority:** P1
- **Preconditions:** Outfit top+bottom, dress, item unavailable.
| # | Action | Expected result |
|---|---|---|
| 1 | `outfitTryOnOptions` | Link `rackIds` top+bottom |
| 2 | Dress | Chỉ dress |
| 3 | Unavailable | Bị bỏ |
- **Expected:** link hợp lệ với phòng thử đồ.
- **Automation:** Yes · **Status:** PASS (EXEC-090)

### TC-172 — Normalize kết quả hydrated
- **Related:** US-032 / AC-100 / BR-145
- **Type:** Positive · **Priority:** P1
- **Preconditions:** Response có top-level outfits + legacy analysisResult.
| # | Action | Expected result |
|---|---|---|
| 1 | `normalizeStylistResult` | Ưu tiên top-level outfits |
| 2 | Legacy | Giữ `outfitCombinations`, `outfits=[]` |
- **Expected:** FE không đọc mã thô thay vì sản phẩm.
- **Automation:** Yes · **Status:** PASS (EXEC-091)

### TC-173 — Color swatches
- **Related:** US-031 / BR-136
- **Type:** Positive · **Priority:** P3
- **Preconditions:** Hex hợp lệ/không hợp lệ/không tên.
| # | Action | Expected result |
|---|---|---|
| 1 | `toColorSwatches` | Hex uppercase; invalid null; bỏ entry không tên |
- **Expected:** không render swatch rỗng.
- **Automation:** Yes · **Status:** PASS (EXEC-092)

### TC-174 — Legacy list an toàn
- **Related:** US-033 / BR-145
- **Type:** Regression · **Priority:** P2
- **Preconditions:** Item dạng string/object thiếu field.
| # | Action | Expected result |
|---|---|---|
| 1 | `toOutfitList`/`toColorList` | Chuẩn hoá, bỏ giá trị null/số |
- **Expected:** không crash khi gặp row cũ.
- **Automation:** Yes · **Status:** PASS (EXEC-093)


## TS-028 — Bổ sung sau bằng chứng BE

### TC-176 — Tổ hợp role sai phải bị loại
- **Related:** US-031 / AC-096 / BR-133 / BUG-056
- **Type:** Negative · **Priority:** P1
- **Preconditions:** Provider trả `[dress, trousers]`, `[top, top]`, `[bottom, bottom]`.
| # | Action | Expected result |
|---|---|---|
| 1 | `resolveOutfits` | Cả ba bị loại |
- **Expected:** chỉ chấp nhận `{top,bottom}` hoặc `{dress}` (ngoài outer).
- **Actual (code):** hiện vẫn giữ các tổ hợp này (BUG-056).
- **Automation:** Yes · **Status:** Not Run

### TC-177 — Đổi số đo phải làm cache miss
- **Related:** US-032 / AC-099 / BR-140 / BUG-055
- **Type:** Regression · **Priority:** P0
- **Preconditions:** User có measurements A; cache row còn hạn.
| # | Action | Expected result |
|---|---|---|
| 1 | Cập nhật measurements sang B | `cacheKey` phải khác |
| 2 | Analyze lại | Gọi Gemini; dùng số đo B; trừ 1 quota |
- **Expected:** không trả lời khuyên dựa trên số đo cũ.
- **Actual (code):** cache hit, không gọi provider (BUG-055).
- **Automation:** Yes · **Status:** Not Run
