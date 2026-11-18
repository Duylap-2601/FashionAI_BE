# Defects — FLW-004 (AI Stylist)

Tất cả là **defect candidate** từ code + test; chưa có reproduction trên môi trường staging/provider thật.

## BUG-042 — Quota có thể bị vượt bởi request đồng thời

- **Severity:** High · **Priority:** P1 · **Status:** Open (candidate)
- **Related:** US-027 / AC-085, AC-086 / BR-119, BR-120 / TC-131, TC-133
- **Environment:** BE, mọi tier; Redis bật hoặc fallback in-memory.
- **Reproduction:**
  1. User FREE còn đúng 1 lượt (`used=2/3`).
  2. Gửi 2 request analyze đồng thời (2 tab).
  3. Cả hai qua `QuotaGuard` trước khi request nào kịp `consumeQuota`.
  4. Cả hai gọi Gemini và cùng `consumeQuota` → `used=4`.
- **Expected:** tối đa 1 request được gọi provider; request thứ hai 429.
- **Actual:** cả hai thành công; vượt hạn mức và tăng chi phí Gemini.
- **Evidence:** `BE/src/common/guards/quota.guard.ts:canActivate:44-52` (chỉ assert); `BE/src/modules/stylist/stylist.service.ts:analyzeAndAdvise:209-249` (consume sau provider). `[INFERENCE]` từ thứ tự code, chưa chạy concurrency test.
- **Root cause:** check-then-act không atomic; `consumeQuota` không phải compare-and-set.
- **Resolution đề xuất:** reserve slot atomic trước provider (Redis `INCR` + rollback khi lỗi), hoặc giữ lock theo user; thêm test 2 request song song.

## BUG-043 — History trả về internals không cần thiết

- **Severity:** Medium · **Priority:** P2 · **Status:** Open (candidate)
- **Related:** US-033 / AC-103 / BR-139, BR-146
- **Environment:** `GET /stylist/history`, `GET /stylist/history/:id`.
- **Reproduction:** Gọi history của chính mình; response chứa `userId`, `cacheKey`, `humanImageHash`, `inputContext`, `rawProviderResponse`, `expiresAt`.
- **Expected:** chỉ trường cần cho UI (id, inputs đã hiển thị, analysis, outfits, hasImage, createdAt).
- **Actual:** spread toàn bộ Prisma row.
- **Evidence:** `BE/src/modules/stylist/stylist.service.ts:getUserHistory:748-752`; `getHistoryItem:767`.
- **Root cause:** `{...item}` thay vì mapper DTO.
- **Resolution:** map response DTO; giữ `rawProviderResponse` server-side.

## BUG-044 — Cache/row stylist hết hạn không được purge

- **Severity:** Medium · **Priority:** P2 · **Status:** Open (candidate)
- **Related:** US-032 / AC-098, AC-099 / BR-139, BR-141
- **Environment:** job maintenance.
- **Reproduction:** Tạo kết quả, chờ quá `STYLIST_CACHE_TTL_DAYS` (mặc định 30); row vẫn còn, gồm `rawProviderResponse` và analysis vĩnh viễn.
- **Expected:** row hết hạn cache được xoá/ẩn theo chính sách retention.
- **Actual:** maintenance chỉ xoá `tryOnResult`; `stylist_results` không bị đụng.
- **Evidence:** `BE/src/modules/maintenance/maintenance.service.ts:cleanupExpiredRecords:42`; `BE/src/modules/stylist/stylist.service.ts:deleteHistoryItem:770`.
- **Root cause:** TTL chỉ dùng cho cache lookup, không phải retention.
- **Resolution:** job purge theo `expiresAt` hoặc tách `expiresAt` (cache) khỏi retention; ghi rõ chính sách.

## BUG-045 — Modal 429 bỏ mất chi tiết quota từ BE

- **Severity:** Medium · **Priority:** P2 · **Status:** Open (candidate)
- **Related:** US-034 / AC-107 / BR-152 / TC-169
- **Environment:** `/ai-stylist`, response 429.
- **Reproduction:** Hết quota, bấm Gửi; BE trả `details.remaining/resetAt/requested`; modal chỉ hiện câu "hết lượt … 00:00 ngày mai".
- **Expected:** hiển thị đúng remaining/resetAt, và copy thiếu lượt khi `requested > remaining`.
- **Actual:** `QuotaExhaustedModal` nhận props nhưng page không truyền; `hasDeficit` luôn false.
- **Evidence:** `FE/src/features/stylist/components/ai-stylist-page.tsx:219`; `QuotaExhaustedModal.tsx:8-25`.
- **Root cause:** page chỉ set boolean mở modal, không lưu error details.
- **Resolution:** parse `error.response.data.details`, truyền vào modal; test component.

## BUG-046 — Lỗi analyze không phải 429 bị gộp một message

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-034 / AC-105 / BR-148
- **Environment:** `/ai-stylist`.
- **Reproduction:** Gửi file sai MIME, hoặc backend 503 `GEMINI_NOT_CONFIGURED`, hoặc 500.
- **Expected:** thông báo phân biệt được lỗi input/feature tạm tắt/lỗi hệ thống.
- **Actual:** mọi lỗi không 429 đều toast "Không thể phân tích phong cách…".
- **Evidence:** `FE/src/features/stylist/components/ai-stylist-page.tsx:152-153`.
- **Root cause:** catch chỉ rẽ nhánh 429.
- **Resolution:** map status/code → message; giữ chi tiết BE khi an toàn.

## BUG-047 — Không validate file phía client

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-028 / AC-091 / BR-126
- **Environment:** `/ai-stylist`, chọn ảnh.
- **Reproduction:** Chọn file HEIC/PDF hoặc >10 MB; FE vẫn preview và gửi, BE mới trả 400.
- **Expected:** chặn ngay khi chọn, thông báo loại/kích thước.
- **Actual:** không kiểm tra; camera input nhận `image/*`.
- **Evidence:** `FE/src/features/stylist/components/ai-stylist-page.tsx:195-209`; `BE/src/common/pipes/file-validation.pipe.ts:26-42`.
- **Root cause:** validation chỉ ở BE.
- **Resolution:** dùng chung whitelist MIME/10 MB trước khi set state.

## BUG-048 — Nhãn dịp mặc lịch sử không khớp dữ liệu

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-033 / AC-108 / BR-144
- **Environment:** panel/trang lịch sử.
- **Reproduction:** Chọn "Họp quan trọng" (chuỗi tiếng Việt) rồi mở lịch sử; label map chỉ có key `office/meeting/...`.
- **Expected:** hiển thị nhãn thân thiện hoặc nguyên chuỗi đã nhập.
- **Actual:** map miss, hiển thị raw string; không sai dữ liệu nhưng không nhất quán.
- **Evidence:** `FE/src/features/stylist/constants/ai-stylist-page.ts:OCCASIONS:3`; `constants/profile-stylist-history-page.ts:OCCASION_LABELS:1-7`.
- **Root cause:** hai vocabulary khác nhau giữa form và history.
- **Resolution:** dùng cùng key hoặc bỏ map khi input là free text.

## BUG-049 — CTA "Hỏi AI Stylist" trỏ sang chatbot

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-034 / AC-108 / BR-155
- **Environment:** product detail.
- **Reproduction:** Bấm "Hỏi AI Stylist" ở product detail → `/chat?productId=...`.
- **Expected:** mở `/ai-stylist` với sản phẩm được chọn (hoặc ghi rõ là chat).
- **Actual:** sang module chatbot; `/ai-stylist` không đọc `productId`.
- **Evidence:** `FE/src/features/products/components/ProductDetailTabs.tsx:126-129`; `ProductPurchasePanel.tsx:159`; `ai-stylist-page.tsx:51-56`.
- **Root cause:** copy CTA dùng route chat.
- **Resolution:** đổi href + thêm đọc `productId` khi mount.

## BUG-050 — Catalog fallback có thể gửi id không phải UUID

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-029 / AC-092 / BR-128
- **Environment:** `/ai-stylist` khi `/products` rỗng.
- **Reproduction:** Xoá/không tải được catalog → picker dùng `PRODUCTS` tĩnh id `p1…p6`; chọn → `productId=p1`; BE `@IsUUID()` trả 400.
- **Expected:** fallback không dùng được làm sản phẩm neo, hoặc id thật.
- **Actual:** UI cho chọn nhưng submit thất bại.
- **Evidence:** `FE/src/features/products/constants/products.ts`; `BE/src/modules/stylist/dto/stylist-request.dto.ts:23`. `[INFERENCE]` chưa chạy live.
- **Root cause:** mock catalog dùng id giả.
- **Resolution:** ẩn picker fallback hoặc map sang sản phẩm thật.

## BUG-051 — `page` không được validate

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-033 / AC-101 / BR-143 / TC-161
- **Environment:** `GET /stylist/history`.
- **Reproduction:** `?page=-1`, `?page=abc` → `skip` âm/NaN vào Prisma.
- **Expected:** 400 hoặc kẹp page ≥1.
- **Actual:** có thể 500; `limit` thì được kẹp.
- **Evidence:** `BE/src/modules/stylist/stylist.controller.ts:getHistory:90-93`; `stylist.service.ts:getUserHistory:725-727`.
- **Root cause:** query param không qua DTO/pipe.
- **Resolution:** ParseIntPipe + clamp page.

## BUG-052 — Contract FE/BE lệch field

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-032, US-034 / AC-100 / BR-148
- **Environment:** type/response.
- **Reproduction:** `recommendedSize` có trong type FE nhưng BE không trả; `garmentDescription` có trong type/FormData nhưng UI không có field.
- **Expected:** type phản ánh đúng response/khả năng UI.
- **Actual:** field chết gây hiểu nhầm; không crash.
- **Evidence:** `FE/src/features/stylist/types/stylist.ts:9,52,78`; `BE/src/modules/stylist/stylist.service.ts:toResultResponse:258-280`.
- **Root cause:** type viết trước/không đồng bộ DTO.
- **Resolution:** xoá field chết hoặc bổ sung UI/BE tương ứng.

## BUG-053 — Rò object URL ảnh preview

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-028 / AC-090 / BR-127
- **Environment:** `/ai-stylist`, đổi/xoá ảnh nhiều lần.
- **Reproduction:** Chọn ảnh → preview `URL.createObjectURL`; xoá/đổi ảnh không `revokeObjectURL`.
- **Expected:** giải phóng blob URL.
- **Actual:** giữ memory đến khi unload trang.
- **Evidence:** `FE/src/features/stylist/components/ai-stylist-page.tsx:79-97`.
- **Root cause:** thiếu cleanup effect.
- **Resolution:** revoke trong `useEffect` cleanup.

## BUG-054 — Lỗi tải history/quota bị bỏ qua ở trang chính

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-034 / AC-107 / BR-154
- **Environment:** `/ai-stylist`.
- **Reproduction:** Chặn API quota/history; trang vẫn hiện "Đang tải lượt" mãi, không có cảnh báo; `hasQuota` mặc định true.
- **Expected:** trạng thái lỗi + retry; không cho gửi khi chưa biết quota.
- **Actual:** `isError` bị bỏ qua; badge treo.
- **Evidence:** `FE/src/features/stylist/hooks/useStylist.ts:46-49`; `ai-stylist-page.tsx:24,29`.
- **Root cause:** destructure thiếu `isError`.
- **Resolution:** hiển thị lỗi và chặn submit khi quota không tải được.

## Tổng hợp

| Severity | Số | ID |
|---|---|---|
| Critical | 0 | — |
| High | 2 | BUG-042, BUG-055 |
| Medium | 4 | BUG-043, BUG-044, BUG-045, BUG-056 |
| Low | 10 | BUG-046…BUG-054, BUG-057 |

## BUG-055 — Cache bỏ qua số đo, trả lời khuyên cũ tới 30 ngày

- **Severity:** High · **Priority:** P1 · **Status:** Open (candidate)
- **Related:** US-032 / AC-099 / BR-140, BR-141 / TC-177
- **Environment:** Analyze khi user đã có `measurements`.
- **Reproduction:**
  1. User có số đo A, chạy analyze với occasion X → row cache TTL 30 ngày.
  2. Cập nhật số đo sang B (cùng occasion/style/budget/gender/catalog, không ảnh).
  3. Chạy lại → `cacheKey` không đổi vì không chứa measurements/`updatedAt`.
  4. Nhận nguyên kết quả dựa trên số đo A, không gọi Gemini, không trừ quota.
- **Expected:** đổi số đo phải làm cache miss (hoặc cache key chứa version số đo).
- **Actual:** cache hit; tư vấn sai kích cỡ/dáng trong tối đa 30 ngày.
- **Evidence:** `BE/src/modules/stylist/stylist.service.ts:buildCacheKey:119-138` (không có measurements); `analyzeAndAdvise:177-195` (cache lookup trước khi load measurements ở `:203-205`).
- **Root cause:** thứ tự load + thành phần cache key thiếu dữ liệu cá nhân hoá.
- **Resolution:** thêm `measurements.updatedAt`/hash số đo vào key, hoặc load measurements trước cache; test TC-177.

## BUG-056 — Resolver không chặn dress + quần / hai top

- **Severity:** Medium · **Priority:** P2 · **Status:** Open (candidate)
- **Related:** US-031 / AC-096 / BR-133 / TC-147, TC-176
- **Environment:** `resolveOutfits`.
- **Reproduction:** Cho provider trả outfit `[dress, trousers]` hoặc `[top, top]`; resolver hiện chỉ kiểm tra mã hợp lệ, trùng, min 2 món (trừ single dress), max item và anchor.
- **Expected:** outfit sai cấu trúc bị loại.
- **Actual:** outfit vẫn được giữ vì không có kiểm tra tổ hợp role.
- **Evidence:** `BE/src/modules/products/product-suggestion.service.ts:resolveOutfits:218-253`; ràng buộc cấu trúc nằm chủ yếu trong prompt `BE/src/modules/stylist/stylist.service.ts:buildPrompt:471-476`.
- **Root cause:** tin prompt thay vì validate hậu kiểm.
- **Resolution:** thêm kiểm tra role set (1 top + 1 bottom | 1 dress), cấm 2 top/2 bottom; test TC-176.

## BUG-057 — Sản phẩm neo INACTIVE vẫn được chấp nhận

- **Severity:** Low · **Priority:** P3 · **Status:** Open (candidate)
- **Related:** US-029 / AC-092, AC-093 / BR-128, BR-131
- **Environment:** `POST /analyze` với `productId` của sản phẩm không ACTIVE.
- **Reproduction:** Gửi id sản phẩm đã ngừng bán; `getProductContext` chỉ `findUnique`, không kiểm tra status.
- **Expected:** 404/400, hoặc ít nhất không dùng làm neo.
- **Actual:** sản phẩm được lưu làm neo; vì không có trong catalog, ràng buộc anchor bị bỏ qua, outfit có thể không chứa sản phẩm đó.
- **Evidence:** `BE/src/modules/stylist/stylist.service.ts:getProductContext:286-293`; `analyzeAndAdvise:206-211`.
- **Root cause:** thiếu điều kiện `status: ACTIVE` và xử lý anchor ngoài catalog.
- **Resolution:** lọc ACTIVE khi lấy product; nếu anchor ngoài catalog thì trả 400 thay vì bỏ ràng buộc.
