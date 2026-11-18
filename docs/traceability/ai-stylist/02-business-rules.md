# Business rules — FLW-004 (AI Stylist)

Quy ước: **Intended** lấy từ UI/API contract hiện tại (không có tài liệu yêu cầu riêng); **Enforced** lấy từ code. `Unknown` khi không đủ bằng chứng. Mọi rule đều có ít nhất một test thiết kế trong `04-test-cases.md`.

## A. Truy cập & quota

### BR-118 — Mọi endpoint stylist yêu cầu JWT
- **Statement:** Analyze, history list/detail/delete chỉ phục vụ user đã đăng nhập; không có endpoint công khai.
- **Type:** Authorization
- **Condition:** Request không có access token hợp lệ.
- **Expected behavior:** 401 `UNAUTHORIZED`; FE middleware đưa về login.
- **Exception:** Không.
- **Related US/AC:** US-027 / AC-085
- **Enforcement point:** `BE/src/modules/stylist/stylist.controller.ts:StylistController:29-33`; `FE/src/middleware.ts:9`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-119 — Hạn mức STYLIST theo tier
- **Statement:** FREE 3 lượt/ngày, MEMBER 20, VIP không giới hạn; gói hết hạn bị hạ về FREE.
- **Type:** Constraint
- **Condition:** User gửi analyze.
- **Expected behavior:** `assertQuota` dùng `AI_ACTION_LIMITS.STYLIST`; VIP `Infinity` bỏ qua đọc counter.
- **Exception:** FREE vẫn có 3 lượt nên không nhánh 402 `SUBSCRIPTION_REQUIRED` cho stylist.
- **Related US/AC:** US-027 / AC-085
- **Enforcement point:** `BE/src/common/constants/ai-quota.constants.ts:AI_ACTION_LIMITS:11-15`; `BE/src/common/services/quota.service.ts:assertQuota:25-113`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-120 — Kiểm tra quota trước, trừ sau khi provider thành công
- **Statement:** Guard chỉ kiểm tra; một lượt chỉ bị trừ sau khi Gemini trả kết quả và row được tạo. Request lỗi không bị tính.
- **Type:** Calculation / Consistency
- **Condition:** Analyze được gọi.
- **Expected behavior:** 429 trước provider nếu hết; `consumeQuota` chỉ ở nhánh thành công.
- **Exception:** Cache hit không trừ (BR-121).
- **Related US/AC:** US-027 / AC-086, AC-087
- **Enforcement point:** `BE/src/common/guards/quota.guard.ts:canActivate:44-52`; `BE/src/modules/stylist/stylist.service.ts:analyzeAndAdvise:249`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-121 — Cache hit không tốn quota nhưng vẫn qua guard
- **Statement:** Kết quả lặp lại trả từ cache, không gọi provider, không tăng `daily_usages`; nhưng user đã hết quota vẫn bị 429 vì guard chạy trước cache.
- **Type:** Calculation
- **Condition:** `cacheKey` trùng và `expiresAt` null/còn hạn.
- **Expected behavior:** 200 `isCached=true`; quota không đổi.
- **Exception:** Cache hết hạn → coi như miss.
- **Related US/AC:** US-027, US-032 / AC-088, AC-099
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:analyzeAndAdvise:179-195`; `stylist.controller.ts:analyze:36-39`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-122 — Thiếu API key thì tắt tính năng
- **Statement:** Không có `GEMINI_API_KEY` → không gọi provider, trả 503.
- **Type:** Error handling
- **Condition:** Analyze.
- **Expected behavior:** 503 `GEMINI_NOT_CONFIGURED`.
- **Exception:** Không.
- **Related US/AC:** US-027 / AC-087
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:analyzeAndAdvise:149-158`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

## B. Input & quyền riêng tư

### BR-123 — Phải có ít nhất một ngữ cảnh
- **Statement:** Request phải có ảnh, hoặc `productId`, hoặc một trong `garmentDescription`/`occasion`/`stylePreference`. Budget một mình không đủ.
- **Type:** Validation
- **Condition:** Tất cả đều rỗng.
- **Expected behavior:** 400 trước khi gọi catalog/provider.
- **Exception:** Không.
- **Related US/AC:** US-027, US-034 / AC-105
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:analyzeAndAdvise:166-171`; `FE/src/features/stylist/services/stylist-utils.ts:validateStylistRequest:19-29`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-124 — Ảnh bắt buộc consent
- **Statement:** Có `humanImage` thì `imageConsent` phải là true; ngược lại 400 và Gemini không được gọi.
- **Type:** Validation / Authorization
- **Condition:** Multipart có file ảnh.
- **Expected behavior:** Chặn trước khi build catalog/prompt.
- **Exception:** Không có ảnh thì consent bị bỏ qua.
- **Related US/AC:** US-028 / AC-089
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:analyzeAndAdvise:160-164`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-125 — Consent được parse nghiêm ngặt
- **Statement:** Chỉ `true` (boolean) hoặc chuỗi `'true'` mới là đồng ý; `'false'`, `'1'`, rỗng đều là false.
- **Type:** Validation
- **Condition:** DTO transform.
- **Expected behavior:** `imageConsent` false → BR-124 chặn.
- **Exception:** Không.
- **Related US/AC:** US-028 / AC-089
- **Enforcement point:** `BE/src/modules/stylist/dto/stylist-request.dto.ts:imageConsent:60-71`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-126 — Giới hạn file ảnh
- **Statement:** File phải không rỗng, ≤10 MB, MIME thuộc jpeg/png/webp.
- **Type:** Validation
- **Condition:** Có file.
- **Expected behavior:** 400; không gọi provider.
- **Exception:** Không.
- **Related US/AC:** US-028 / AC-091
- **Enforcement point:** `BE/src/common/pipes/file-validation.pipe.ts:transform:18-43`; `stylist.controller.ts:analyze:70-73`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-127 — Ảnh không được lưu, chỉ lưu hash + mốc consent
- **Statement:** `humanImageUrl` luôn null; lưu SHA-256 của bytes và `inputContext.imageConsentAt`; bytes chỉ gửi inline cho Gemini trong request.
- **Type:** Consistency / Constraint
- **Condition:** Có ảnh.
- **Expected behavior:** Không có URL/bytes trong DB; hash không khôi phục được ảnh.
- **Exception:** Row legacy có thể còn `humanImageUrl`.
- **Related US/AC:** US-028 / AC-090
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:analyzeAndAdvise:173-174,219,239`; `toResultResponse:263`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

## C. Catalog & kết quả

### BR-128 — `productId` phải là UUID và tồn tại
- **Statement:** DTO validate UUID; BE tra DB, không thấy → 404. Không kiểm tra trạng thái ACTIVE của sản phẩm neo.
- **Type:** Validation
- **Condition:** Có `productId`.
- **Expected behavior:** 400 nếu sai định dạng; 404 nếu không tồn tại; chưa trừ quota.
- **Exception:** Sản phẩm INACTIVE vẫn được dùng làm neo và mất ràng buộc anchor (BUG-057).
- **Related US/AC:** US-029 / AC-092
- **Enforcement point:** `BE/src/modules/stylist/dto/stylist-request.dto.ts:productId:17-24`; `BE/src/modules/stylist/stylist.service.ts:getProductContext:286-293`
- **Intended / Enforced:** yes / partial
- **Confidence:** High
- **Verification:** Code-verified

### BR-129 — Catalog chỉ gồm sản phẩm ACTIVE, tối đa 150
- **Statement:** `getCatalog` lấy sản phẩm ACTIVE, gán mã `P1..Pn`, kèm ảnh chính/màu; fingerprint = hash(id:gender) 16 ký tự.
- **Type:** Constraint
- **Condition:** Mỗi analyze (cache miss hoặc build key).
- **Expected behavior:** AI chỉ thấy sản phẩm đang bán; catalog đổi → fingerprint/cache key đổi.
- **Exception:** Catalog >150 bị cắt theo query.
- **Related US/AC:** US-031, US-032 / AC-095, AC-099
- **Enforcement point:** `BE/src/modules/products/product-suggestion.service.ts:getCatalog:112-152`; `CATALOG_LIMIT:78`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-130 — Lọc theo giới tính + unisex
- **Statement:** `male`/`female` chỉ nhận sản phẩm cùng giới và unisex; `other`/trống nhận tất cả.
- **Type:** Workflow
- **Condition:** `genderPreference` được gửi.
- **Expected behavior:** Prompt/catalog đúng audience; mã được đánh lại từ P1.
- **Exception:** Không.
- **Related US/AC:** US-030 / AC-094
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:analyzeAndAdvise:176`; `product-suggestion.service.ts:toCatalogAudience:90-110`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-131 — Outfit phải chứa sản phẩm neo
- **Statement:** Khi có `productId` và sản phẩm nằm trong catalog, mọi outfit được giữ phải chứa mã neo; outfit khác bị loại.
- **Type:** Constraint
- **Condition:** Anchor tồn tại trong catalog.
- **Expected behavior:** Prompt nêu mã neo; resolver lọc lần nữa.
- **Exception:** Anchor không có trong catalog (INACTIVE/bị cắt) → không áp ràng buộc (BUG-057).
- **Related US/AC:** US-029 / AC-093
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:analyzeAndAdvise:206-211`; `product-suggestion.service.ts:resolveOutfits:218-253`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-132 — Mã sản phẩm AI trả phải khớp catalog
- **Statement:** Mã lạ, trùng lặp hoặc sản phẩm đã bị xoá bị loại; outfit còn <2 món (trừ dress) bị bỏ.
- **Type:** Consistency
- **Condition:** Parse kết quả provider.
- **Expected behavior:** Không bao giờ trả sản phẩm bịa.
- **Exception:** Không.
- **Related US/AC:** US-031 / AC-095
- **Enforcement point:** `BE/src/modules/products/product-suggestion.service.ts:resolveOutfits:218-253`; `buildOutfits:323-345`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-133 — Cấu trúc outfit
- **Statement:** Outfit hợp lệ có 1 top + 1 bottom, hoặc 1 dress; tối đa 5 món, tối đa 4 outfit; role chuẩn hoá `top|bottom|outer|dress`; không trùng sản phẩm.
- **Type:** Constraint
- **Condition:** Resolve kết quả.
- **Expected behavior:** Outfit sai cấu trúc bị loại, không tự sửa thành bộ khác.
- **Exception:** Không. Trước 2026-11-18 resolver bỏ qua tổ hợp dress+quần / 2 top (BUG-056, đã sửa).
- **Related US/AC:** US-031 / AC-096
- **Enforcement point:** `BE/src/modules/products/product-suggestion.service.ts:resolveOutfits:218-253`; `isValidOutfitComposition:398-408`; prompt `BE/src/modules/stylist/stylist.service.ts:buildPrompt:471-476`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-134 — Giá outfit chỉ tính món còn hàng
- **Statement:** `totalPrice` = tổng `price` của item `available=true`; món hết hàng vẫn hiển thị nhưng không cộng tiền.
- **Type:** Calculation
- **Condition:** Hydrate/build outfit.
- **Expected behavior:** VND, không nhân số lượng.
- **Exception:** Không.
- **Related US/AC:** US-031 / AC-097
- **Enforcement point:** `BE/src/modules/products/product-suggestion.service.ts:buildOutfits:323-345`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-135 — Provider phải trả JSON
- **Statement:** Gọi Gemini với `responseMimeType='application/json'`; output có thể còn markdown fence và phải được strip trước parse.
- **Type:** Integration
- **Condition:** Mỗi lần gọi model.
- **Expected behavior:** Object JSON; không JSON → lỗi parse.
- **Exception:** Không.
- **Related US/AC:** US-031 / AC-095
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:callGeminiWithRetry:564-568`; `parseRawResponse:364`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-136 — Chuẩn hoá & clamp kết quả
- **Statement:** Bắt buộc `fitRecommendation`, `stylingTips`, `verdict`; field khuôn mặt chỉ bắt buộc khi có ảnh; score clamp 0..100; color hex chỉ giữ `#RRGGBB`, còn lại `hex=null`; object array được chuẩn hoá.
- **Type:** Validation / Calculation
- **Condition:** Sau parse.
- **Expected behavior:** Dữ liệu an toàn để render; field thiếu → lỗi 502 (sau repair).
- **Exception:** Warning không bắt buộc.
- **Related US/AC:** US-031 / AC-095, AC-097
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:validateResult:616-704`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-137 — Repair một lần khi output hỏng
- **Statement:** Parse/validate thất bại → gọi lại đúng một lần với prompt sửa + 2000 ký tự output lỗi; vẫn hỏng → 502.
- **Type:** Error handling / Integration
- **Condition:** JSON không parse được hoặc thiếu field.
- **Expected behavior:** Tối đa 1 repair call; không lặp vô hạn.
- **Exception:** Timeout/lỗi mạng ở repair đi qua `handleError`.
- **Related US/AC:** US-031 / AC-095
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:generateAnalysis:490-518`; `buildRepairPrompt:520-541`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-138 — Ánh xạ lỗi provider
- **Statement:** Message chứa API key/401 → 401 `INVALID_API_KEY`; chứa 429/quota → 429 `QUOTA_EXCEEDED`; parse/schema → 502 `GEMINI_INVALID_RESPONSE`; còn lại → 500 `GEMINI_ERROR`.
- **Type:** Error handling
- **Condition:** Exception từ provider/parse.
- **Expected behavior:** Client nhận mã ổn định; chi tiết provider nằm trong `details` (rủi ro lộ internals — BUG-043).
- **Exception:** `HttpException` đã có được ném nguyên.
- **Related US/AC:** US-027 / AC-086
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:handleError:786-850`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

## D. Lưu trữ, cache, lịch sử

### BR-139 — Lưu đầy đủ ngữ cảnh và output
- **Statement:** Row mới chứa input đã trim, `inputContext` (kể cả `hasMeasurements`, `imageConsentAt`, `catalogFingerprint`), `model`, `analysisResult`, `rawProviderResponse.text`, `cacheKey`, `expiresAt`.
- **Type:** Consistency
- **Condition:** Cache miss thành công.
- **Expected behavior:** Tái tạo được kết quả/lịch sử mà không cần provider.
- **Exception:** Ảnh không lưu (BR-127).
- **Related US/AC:** US-032 / AC-098
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:analyzeAndAdvise:212-247`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-140 — Cache key gồm mọi yếu tố ảnh hưởng kết quả
- **Statement:** `promptVersion | userId | imageHash/no-image | catalogFingerprint | productId | garmentDescription | occasion | stylePreference | budget | genderPreference` (trim, `none` cho rỗng), SHA-256.
- **Type:** Consistency
- **Condition:** Mỗi analyze.
- **Expected behavior:** Đổi bất kỳ input/catalog/prompt version/số đo → key khác.
- **Exception:** Không. Từ 2026-11-18 key có thêm fingerprint số đo (`buildMeasurementsFingerprint`) — BUG-055 đã sửa.
- **Related US/AC:** US-032 / AC-099 / BR-140, BR-141 / TC-177
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:buildCacheKey:125-156`; `STYLIST_PROMPT_VERSION:26`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-141 — Cache TTL mặc định 30 ngày
- **Statement:** `STYLIST_CACHE_TTL_DAYS` (mặc định 30) quyết định `expiresAt`; row hết hạn không được dùng làm cache.
- **Type:** Constraint
- **Condition:** Tạo row / lookup.
- **Expected behavior:** Lookup chỉ nhận `expiresAt=null` hoặc `> now`.
- **Exception:** Không. Từ 2026-11-18 `cleanupExpiredRecords` purge row hết hạn (BUG-044 đã sửa).
- **Related US/AC:** US-032 / AC-099
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:constructor:107-109`; `buildCacheExpiry:140-142`; `analyzeAndAdvise:181-185`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-142 — Cache và dữ liệu chỉ thuộc một user
- **Statement:** Cache lookup và history đều filter `userId`; `cacheKey` chứa userId nên không thể hit chéo.
- **Type:** Authorization / Consistency
- **Condition:** Mọi truy vấn stylist.
- **Expected behavior:** Không trả dữ liệu người khác.
- **Exception:** Không.
- **Related US/AC:** US-032, US-033 / AC-099, AC-103
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:analyzeAndAdvise:179-187`; `findOwnedResult:775-784`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-143 — Lịch sử mới nhất trước, limit bị kẹp
- **Statement:** Sort `createdAt desc`; `limit` kẹp 1..100; `skip=(page-1)*limit`; `page` không được validate.
- **Type:** Constraint
- **Condition:** `GET /history`.
- **Expected behavior:** Trang hợp lệ trả đúng cửa sổ; `page` âm/NaN có thể gây 500 (BUG-051).
- **Exception:** `limit` thiếu → 20.
- **Related US/AC:** US-033 / AC-101
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:getUserHistory:725-733`
- **Intended / Enforced:** yes / partial
- **Confidence:** High
- **Verification:** Code-verified

### BR-144 — Meta phân trang
- **Statement:** Trả `{total, page, limit: safeLimit, totalPages: ceil(total/safeLimit)}` trong envelope.
- **Type:** Consistency
- **Condition:** List thành công.
- **Expected behavior:** FE dùng `total/totalPages` để hiển thị và phân trang.
- **Exception:** Không.
- **Related US/AC:** US-033 / AC-101
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:getUserHistory:753-758`; `stylist.controller.ts:getHistory:93-100`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-145 — Hydrate một query cho cả trang
- **Statement:** Gom productId của mọi outfit trong trang, `loadProducts` một lần, build lại outfit với giá/ảnh hiện tại.
- **Type:** Consistency / Integration
- **Condition:** List/detail/analyze response.
- **Expected behavior:** Không N+1; sản phẩm đã xoá bị loại khỏi outfit.
- **Exception:** Item legacy `outfitCombinations` không có `outfits` → trả `[]`.
- **Related US/AC:** US-033 / AC-102
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:getUserHistory:738-751`; `product-suggestion.service.ts:buildOutfits:323`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-146 — Chỉ chủ sở hữu xem/xoá
- **Statement:** Detail/delete dùng `findFirst({id,userId})`; không tồn tại hoặc của người khác → cùng một 404.
- **Type:** Authorization
- **Condition:** `GET/DELETE /history/:id`.
- **Expected behavior:** Không phân biệt 404 "không có" và "không phải của bạn".
- **Exception:** Không.
- **Related US/AC:** US-033 / AC-103, AC-104
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:getHistoryItem:762-768`; `findOwnedResult:775-784`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-147 — Xoá là hard delete
- **Statement:** Kiểm tra sở hữu rồi xoá row; không soft-delete/không lưu bản sao.
- **Type:** Consistency
- **Condition:** Delete thành công.
- **Expected behavior:** 200 `data:null`; row biến mất khỏi list.
- **Exception:** Không.
- **Related US/AC:** US-033 / AC-104
- **Enforcement point:** `BE/src/modules/stylist/stylist.service.ts:deleteHistoryItem:770-773`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-148 — Envelope API thống nhất
- **Statement:** Mọi response dùng `{success, code, message, timestamp, path, data, meta?}`; lỗi do global filter chuẩn hoá code.
- **Type:** Consistency
- **Condition:** Mọi request.
- **Expected behavior:** FE đọc `data`/`meta` ổn định.
- **Exception:** Không.
- **Related US/AC:** US-027 / AC-087
- **Enforcement point:** `BE/src/common/utils/api-response.util.ts:buildApiResponse:18-33`; `common/filters/http-exception.filter.ts:catch:24-73`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

## E. Web FE

### BR-149 — Validate client song song BE
- **Statement:** FE chặn ảnh thiếu consent và request không có product/dịp/phong cách/ảnh; budget không tính là ngữ cảnh.
- **Type:** Validation
- **Condition:** Bấm Gửi.
- **Expected behavior:** Không gọi API; toast lỗi tương ứng.
- **Exception:** Server vẫn kiểm tra lại.
- **Related US/AC:** US-034 / AC-105
- **Enforcement point:** `FE/src/features/stylist/services/stylist-utils.ts:validateStylistRequest:19-29`; `ai-stylist-page.tsx:124-130`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-150 — Multipart chỉ gửi consent khi có ảnh
- **Statement:** `imageConsent='true'` chỉ append khi `humanImage` tồn tại và đã tick; các field rỗng không gửi.
- **Type:** Validation / Consistency
- **Condition:** Build FormData.
- **Expected behavior:** Không gửi consent "mồ côi"; BE không thấy field thừa.
- **Exception:** Không.
- **Related US/AC:** US-034 / AC-106
- **Enforcement point:** `FE/src/features/stylist/services/stylist-utils.ts:buildFormData:31-45`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-151 — Analyze timeout 90 giây
- **Statement:** Client chờ tối đa 90 s cho analyze; timeout không huỷ provider phía server.
- **Type:** Integration
- **Condition:** Request analyze.
- **Expected behavior:** UI báo lỗi sau 90 s; server vẫn có thể hoàn tất và trừ quota.
- **Exception:** Không.
- **Related US/AC:** US-034 / AC-107
- **Enforcement point:** `FE/src/features/stylist/services/mutations.ts:analyzeStylist:5-13`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-152 — UI quota và modal khi hết lượt
- **Statement:** Badge `limit - used` (∞ cho VIP); `hasQuota=false` chặn submit và mở modal; 429 từ server cũng mở modal.
- **Type:** Workflow
- **Condition:** Quota 0 hoặc response 429.
- **Expected behavior:** Không gửi request khi đã biết hết quota; modal có CTA nâng cấp.
- **Exception:** Không. Từ 2026-11-18 modal nhận `requested/remaining/resetAt` từ `details` (BUG-045 đã sửa).
- **Related US/AC:** US-034 / AC-107
- **Enforcement point:** `FE/src/features/stylist/components/ai-stylist-page.tsx:99-111,124-153`; `QuotaExhaustedModal.tsx`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-153 — Deep link `?result=<id>` khôi phục kết quả
- **Statement:** Khi mount, nếu query có `result` thì `GET /history/:id`, hiển thị result; URL được cập nhật bằng `replaceState` (không thêm history entry).
- **Type:** Workflow
- **Condition:** Có query param.
- **Expected behavior:** Reload/chia sẻ link vẫn xem được kết quả của chính user; 404 → trạng thái lỗi.
- **Exception:** Chỉ đọc một lần lúc mount, không react khi query đổi.
- **Related US/AC:** US-034 / AC-108
- **Enforcement point:** `FE/src/features/stylist/components/ai-stylist-page.tsx:51-56`; `useStylist.ts:useStylistResult`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-154 — Lịch sử web 5 mục/trang
- **Statement:** Panel lịch sử tải 5 item/trang; xoá item đang chọn đưa UI về idle và xoá `result` khỏi URL; lỗi list không được hiển thị ở panel trang chủ.
- **Type:** Workflow
- **Condition:** Mở panel / xoá.
- **Expected behavior:** Phân trang và trạng thái chọn nhất quán.
- **Exception:** Không. Từ 2026-11-18 lỗi list/quota hiện banner + retry (BUG-054 đã sửa).
- **Related US/AC:** US-033, US-034 / AC-108
- **Enforcement point:** `FE/src/features/stylist/components/ai-stylist-page.tsx:29,180-195`; `profile-stylist-history-page.tsx`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified

### BR-155 — Chuyển tiếp sang thử đồ / giỏ hàng
- **Statement:** Card outfit tạo link `/try-on?productId=` hoặc `/try-on?rackIds=` với tối đa 1 top + 1 bottom (hoặc 1 dress); sản phẩm suggested thêm được vào giỏ với variant màu/size.
- **Type:** Workflow
- **Condition:** User bấm CTA trên kết quả.
- **Expected behavior:** Chỉ link sản phẩm available; dress không ghép với quần.
- **Exception:** Sản phẩm unavailable bị bỏ khỏi link.
- **Related US/AC:** US-031, US-034 / AC-097, AC-108
- **Enforcement point:** `FE/src/features/stylist/services/outfit-suggestions.ts:outfitTryOnOptions`; `tests/outfit-suggestions.test.cjs:149`
- **Intended / Enforced:** yes / yes
- **Confidence:** High
- **Verification:** Code-verified
