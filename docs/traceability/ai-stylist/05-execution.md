# Execution records — FLW-004 (AI Stylist)

- **Ngày chạy:** 2026-11-18
- **Môi trường:** Windows 10, Node per repo; Jest BE (`test/jest-unit.json`, `test/jest-e2e.json`), `node --test` FE. Prisma và `@google/genai` đều bị mock; không có Postgres/Redis/Gemini/browser thật.
- **Build/commit:** không ghi (workspace làm việc, không phải CI artifact).
- **Tester:** coding assistant + subagent đo lường test, log tại `D:/EXE/.tmp/stylist-*.log`.

| EXEC | TC | Lệnh / file | Kết quả | Bằng chứng |
|---|---|---|---|---|
| EXEC-062 | TC-131 | `npx jest --config test/jest-unit.json test/unit/quota.service.spec.ts` | PASS | `assertQuota('free-1','FREE','STYLIST')` cho phép used=2, 429 ở used=3 |
| EXEC-063 | TC-133 | `test/unit/quota.guard.spec.ts` | PASS | 429 `QUOTA_EXCEEDED` lan nguyên vẹn; 5/5 |
| EXEC-064 | TC-134 | `test/unit/stylist.service.spec.ts` | PASS | `should throw GEMINI_NOT_CONFIGURED when API key is missing` |
| EXEC-065 | TC-135 | `test/unit/stylist.service.spec.ts` | PASS | `should throw BadRequestException when there is no image and no input at all` |
| EXEC-066 | TC-136 | `test/unit/stylist.service.spec.ts` | PASS | `should reject an image sent without consent and never call Gemini` |
| EXEC-067 | TC-137 | `npx jest --config test/jest-e2e.json test/e2e/stylist-analyze.e2e-spec.ts` | PASS | `từ chối ảnh gửi kèm mà không có xác nhận đồng ý` (thiếu + `'false'`) |
| EXEC-068 | TC-138 | `test/unit/stylist.controller.spec.ts` | PASS | `should reject analyze when the uploaded file is not an image` |
| EXEC-069 | TC-140 | `test/e2e/stylist-analyze.e2e-spec.ts` | PASS | `phân tích ảnh có đồng ý nhưng không lưu ảnh`; `humanImageUrl=null`, hash string |
| EXEC-070 | TC-141 | `test/unit/stylist.service.spec.ts` | PASS | `should throw NotFoundException for unknown product` (404) |
| EXEC-071 | TC-143 | `test/unit/product-suggestion.service.spec.ts` | PASS | `getCatalog` ACTIVE-only, mã P1..Pn, prompt line format; 11/11 |
| EXEC-072 | TC-144 | `test/unit/stylist.service.spec.ts` | PASS | `should only show items for the chosen gender plus unisex items to Gemini` |
| EXEC-073 | TC-145 | `test/unit/stylist.service.spec.ts` | PASS | `should keep only outfits containing the chosen product` |
| EXEC-074 | TC-146 | `test/unit/stylist.service.spec.ts` | PASS | `should suggest catalog outfits without an image and drop invalid ones` (P90/P91 dropped) |
| EXEC-075 | TC-147 | `test/unit/product-suggestion.service.spec.ts` | PASS | `resolveOutfits`: bỏ mã lạ/trùng, bỏ outfit 1 món không phải dress |
| EXEC-076 | TC-148 | `test/unit/product-suggestion.service.spec.ts` | PASS | `buildOutfits`: role order; món hết hàng không vào `totalPrice` |
| EXEC-077 | TC-149 | `test/unit/stylist.service.spec.ts` | PASS | `should run a successful analysis and save metadata + consume quota` |
| EXEC-078 | TC-150 | `test/unit/stylist.service.spec.ts` | PASS | `should return hydrated outfits from cache without calling Gemini` |
| EXEC-079 | TC-152 | `test/unit/product-suggestion.service.spec.ts` | PASS | `fingerprint changes when product gender changes` |
| EXEC-080 | TC-153 | `test/unit/stylist.service.spec.ts` | PASS | Cache-hit test: outfit hydrate tên sản phẩm, quota không gọi |
| EXEC-081 | TC-154 | `test/unit/stylist.service.spec.ts` | PASS | `parseRawResponse should strip markdown fences` + throw khi không có JSON |
| EXEC-082 | TC-155 | `test/unit/stylist.service.spec.ts` | PASS | `validateResult should throw when a required field is missing` |
| EXEC-083 | TC-156 | `test/unit/stylist.service.spec.ts` | PASS | `validateResult should clamp score and normalize object arrays` |
| EXEC-084 | TC-157 | `test/unit/stylist.service.spec.ts` | PASS | `validateResult should keep valid color hex codes and drop malformed ones` |
| EXEC-085 | TC-158 | `test/unit/stylist.service.spec.ts` | PASS | `should map Gemini quota/429 errors to 429 HttpException` |
| EXEC-086 | TC-162 | `test/unit/stylist.service.spec.ts` | PASS | `getUserHistory should attach hydrated outfits ... with one product query` |
| EXEC-087 | TC-165 | `node --test tests/outfit-suggestions.test.cjs` | PASS | `stylist form data ... validation mirrors the backend` (8/8 file) |
| EXEC-088 | TC-166 | `tests/outfit-suggestions.test.cjs` | PASS | Nhánh photo-without-consent trả message `/xác nhận/` |
| EXEC-089 | TC-167 | `tests/outfit-suggestions.test.cjs` | PASS | `imageConsent` chỉ append khi có ảnh |
| EXEC-090 | TC-171 | `tests/outfit-suggestions.test.cjs` | PASS | `outfitTryOnOptions offers ... 1 top + 1 bottom, or a dress` |
| EXEC-091 | TC-172 | `tests/outfit-suggestions.test.cjs` | PASS | `normalizeStylistResult uses hydrated top-level outfits` |
| EXEC-092 | TC-173 | `tests/outfit-suggestions.test.cjs` | PASS | `toColorSwatches keeps valid hex codes and falls back ...` |
| EXEC-093 | TC-174 | `node --test tests/error-handling.test.cjs` | PASS | `stylist lists preserve legacy strings ... without unsafe values` |

## Tổng hợp lần chạy

| File | Tests | Kết quả |
|---|---:|---|
| BE `stylist.service.spec.ts` | 18 | 18 PASS |
| BE `stylist.controller.spec.ts` | 6 | 6 PASS |
| BE `stylist-analyze.e2e-spec.ts` | 4 | 4 PASS |
| BE `product-suggestion.service.spec.ts` | 11 | 11 PASS |
| BE `quota.service.spec.ts` | 10 | 10 PASS |
| BE `quota.guard.spec.ts` | 5 | 5 PASS |
| FE `outfit-suggestions.test.cjs` | 8 | 8 PASS |
| FE `error-handling.test.cjs` | 2 | 2 PASS (1 stylist) |

## Lần chạy bổ sung — fix defect 2026-11-18

| EXEC | BUG/TC | File | Kết quả | Test |
|---|---|---|---|---|
| EXEC-094 | BUG-042 / TC-131, TC-133 | `test/unit/quota.service.spec.ts` | PASS | `reserveQuota` atomic: giữ chỗ, 429 + hoàn lượt, seed `SET NX` |
| EXEC-095 | BUG-043 | `test/unit/stylist.service.spec.ts` | PASS | `getUserHistory should not leak internal storage fields` |
| EXEC-096 | BUG-051 / TC-161 | `stylist.service.spec.ts` | PASS | `getUserHistory should clamp invalid page/limit values` |
| EXEC-097 | BUG-055 / TC-177 | `stylist.service.spec.ts` | PASS | `should change the cache key when body measurements change` |
| EXEC-098 | BUG-056 / TC-147, TC-176 | `product-suggestion.service.spec.ts` | PASS | `resolveOutfits loại outfit sai cấu trúc` |
| EXEC-099 | BUG-057 | `stylist.service.spec.ts` | PASS | `should reject an inactive anchor product and release the reserved quota` |
| EXEC-100 | BUG-046/047/048/049/050/052/053/054 | `tests/error-handling.test.cjs` | PASS | `validateStylistImage` + `parseQuotaErrorDetails` |

Kết quả lần chạy: BE unit `318/318` (49 suite), BE e2e `stylist-analyze` `4/4`, FE `122/122`; `tsc --noEmit` cả hai repo sạch.

## Lần chạy bổ sung — đóng 15 TC `Not Run` (2026-11-18)

| EXEC | TC | File | Kết quả | Test |
|---|---|---|---|---|
| EXEC-101 | TC-132 | `test/unit/quota.service.spec.ts` | PASS | MEMBER 19→20, VIP không đọc counter |
| EXEC-102 | TC-175 | `test/e2e/stylist-auth.e2e-spec.ts` | PASS | 401 `UNAUTHORIZED` cho analyze + history; token sai chữ ký |
| EXEC-103 | TC-139 | `test/unit/file-validation.pipe.spec.ts` | PASS | Biên 10 MB + 1 byte → 400; đúng 10 MB qua |
| EXEC-104 | TC-142 | `test/e2e/stylist-analyze.e2e-spec.ts` | PASS | `productId='abc'` → 400 `VALIDATION_ERROR` |
| EXEC-105 | TC-151 | `test/unit/stylist.service.spec.ts` | PASS | Lookup chỉ nhận `expiresAt` còn hạn; cache miss tạo row mới |
| EXEC-106 | TC-159 | `test/unit/stylist.service.spec.ts` | PASS | Repair đúng 1 lần; vẫn hỏng → 502, không gọi lần 3 |
| EXEC-107 | TC-160 | `test/unit/stylist.service.spec.ts` | PASS | 401 `INVALID_API_KEY`; 500 `GEMINI_ERROR`; không lưu row |
| EXEC-108 | TC-161 | `test/unit/stylist.service.spec.ts` | PASS | page=2 limit=5 → skip 5; limit=1000 → kẹp 100; `abc` → page 1 |
| EXEC-109 | TC-163 | `test/unit/stylist.service.spec.ts` | PASS | Detail/delete row của user khác → 404, không xoá |
| EXEC-110 | TC-164 | `test/unit/stylist.service.spec.ts` | PASS | Delete row của chính mình → xoá theo `{id, userId}` |
| EXEC-111 | TC-168 | `tests/error-handling.test.cjs` | PASS | `http.post('/stylist/analyze', …, {timeout: 90000})` |
| EXEC-112 | TC-169 | `tests/error-handling.test.cjs` | PASS | `resolveQuotaGate`: blocked/loading/unavailable; `details` vào modal |
| EXEC-113 | TC-170 | `tests/error-handling.test.cjs` | PASS | `parseStylistDeepLink`/`buildStylistDeepLink` giữ/xoá `result` |
| EXEC-114 | TC-176 | `test/unit/product-suggestion.service.spec.ts` | PASS | Loại `[dress,trousers]`, `[top,top]`, `[bottom,bottom]` |
| EXEC-115 | TC-177 | `test/unit/stylist.service.spec.ts` | PASS | Đổi số đo → `cacheKey` khác |

Kết quả: BE unit `326/326` (50 suite), BE e2e `147/147` (16 suite), FE `125/125`; `tsc --noEmit` sạch. Không còn TC `Not Run`.

## Giới hạn bằng chứng

- `admin-stats` (2 test) chỉ stub `stylistResult.count`; không tính là coverage stylist.
- Đã bổ sung test cho ownership/404, pagination, repair, 401/500/502, cache expiry, upload >10 MB, quota gate và deep link FE (EXEC-101…115).
- Vẫn chưa có: browser/RTL component test, Gemini/Postgres/Redis thật, upload ảnh thật.
- Không chứng minh Gemini trả JSON đúng schema ngoài đời, không chứng minh WebRTC/UI thật.
- Không có test nào bị tính hai lần: mỗi EXEC ánh xạ một test/nhánh riêng.
