# User stories & acceptance criteria — FLW-004 (AI Stylist)

Không có tài liệu yêu cầu gốc cho module này; story được **suy ra từ hành vi đã triển khai** và ghi rõ như vậy. Giá trị nghiệp vụ không được bịa thêm ngoài những gì UI/API thể hiện.

## US-027 — Nhận bộ outfit từ catalog đang bán

- **Actor:** USER (FREE/MEMBER/VIP)
- **Story:** As a người dùng đã đăng nhập, I want gửi dịp mặc/phong cách/ngân sách và nhận outfit chỉ gồm sản phẩm đang bán, so that tôi mua được bộ đồ phù hợp mà không phải tự phối.
- **Description:** `POST /stylist/analyze` trả `outfits` đã hydrate; quota theo tier; cache theo input.
- **Preconditions:** JWT; còn quota; Gemini đã cấu hình.
- **Postconditions:** kết quả lưu `stylist_results` (cache miss); quota +1 chỉ khi gọi thành công.
- **Priority:** P0
- **Source:** `BE/src/modules/stylist/stylist.service.ts:analyzeAndAdvise:144`; `FE/src/features/stylist/components/ai-stylist-page.tsx:handleAnalyze:110`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-085…AC-088

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-085 | User tier FREE/MEMBER/VIP | Mở trang và gửi yêu cầu | Hạn mức ngày lần lượt 3/20/∞; hết lượt bị 429 trước khi gọi Gemini | Verified (TC-131, TC-133) |
| AC-086 | Quota đã hết | Bấm Gửi | Không có request provider; FE mở modal quota; BE trả 429 `QUOTA_EXCEEDED` kèm `used/limit/remaining/resetAt` | Verified (TC-133, TC-169) |
| AC-087 | Còn quota, Gemini trả kết quả hợp lệ | Request thành công | `daily_usages` +1 đúng một lần; response 200 có `id` và `outfits` | Verified (TC-149) |
| AC-088 | Cùng user + cùng input + cùng catalog | Gửi lại trong TTL | Trả bản ghi cũ với `isCached=true`; không gọi Gemini, không trừ quota | Verified (TC-150) |

## US-028 — Dùng ảnh cá nhân có kiểm soát

- **Actor:** USER
- **Story:** As a người dùng, I want tải ảnh của mình và đồng ý rõ ràng, so that AI phân tích dáng/màu da mà ảnh không bị lưu.
- **Description:** Ảnh tuỳ chọn, chỉ nhận jpeg/png/webp ≤10 MB; BE lưu hash SHA-256 và `imageConsentAt`, không lưu bytes.
- **Preconditions:** Đã chọn file.
- **Postconditions:** `humanImageUrl=null`, `humanImageHash` có giá trị.
- **Priority:** P0 (privacy)
- **Source:** `BE/src/modules/stylist/stylist.service.ts:analyzeAndAdvise:160`; `common/pipes/file-validation.pipe.ts:26`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-089…AC-091

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-089 | Có file ảnh | Gửi mà không tick hoặc `imageConsent='false'` | 400; Gemini không được gọi | Verified (TC-136, TC-137) |
| AC-090 | Consent hợp lệ | Phân tích thành công | Ảnh không được lưu; chỉ hash + `imageConsentAt`; `humanImageUrl=null` | Verified (TC-140) |
| AC-091 | File không phải ảnh hoặc >10 MB | Gửi | 400 từ `FileValidationPipe` | Verified (TC-138); >10 MB chưa chạy (TC-139) |

## US-029 — Neo tư vấn vào một sản phẩm thật

- **Actor:** USER
- **Story:** As a người dùng đang cân nhắc một món, I want chọn nó từ catalog, so that outfit gợi ý chắc chắn chứa món đó.
- **Description:** `productId` UUID; BE lấy sản phẩm, gán mã catalog, prompt buộc outfit chứa mã neo.
- **Preconditions:** Sản phẩm tồn tại.
- **Postconditions:** `productId` lưu cùng kết quả; mọi outfit giữ món neo.
- **Priority:** P1
- **Source:** `BE/src/modules/stylist/stylist.service.ts:getProductContext:286`; `product-suggestion.service.ts:resolveOutfits:218`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-092…AC-093

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-092 | `productId` không phải UUID / không tồn tại | Gửi | 400 validation hoặc 404; không gọi provider, không trừ quota | Verified (TC-141); UUID sai chưa chạy (TC-142) |
| AC-093 | Sản phẩm neo hợp lệ | Gemini trả outfit | Mọi outfit được giữ phải chứa sản phẩm neo; outfit không chứa bị loại | Verified (TC-145) |

## US-030 — Lọc catalog theo giới tính

- **Actor:** USER
- **Story:** As a người dùng, I want chọn Nam/Nữ, so that AI chỉ thấy đồ phù hợp và đồ unisex.
- **Description:** `genderPreference` male/female/other; `other`/trống nhận toàn bộ catalog.
- **Preconditions:** —
- **Postconditions:** Prompt/catalog chỉ chứa audience đã chọn; fingerprint đổi khi gender sản phẩm đổi.
- **Priority:** P1
- **Source:** `BE/src/modules/stylist/stylist.service.ts:analyzeAndAdvise:176`; `product-suggestion.service.ts:getCatalog:112`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-094

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-094 | Catalog có nam/nữ/unisex | Gửi `genderPreference=male` | Prompt chỉ có đồ nam + unisex; nữ bị loại; `other` nhận tất cả | Verified (TC-144) |

## US-031 — Outfit hợp lệ và mua được

- **Actor:** USER
- **Story:** As a người dùng, I want outfit chỉ chứa món có thật, đúng cấu trúc và còn hàng, so that tôi không nhận gợi ý ảo hoặc không mua được.
- **Description:** Mã sản phẩm do AI trả phải khớp catalog; cấu trúc 1 top + 1 bottom hoặc 1 dress; `totalPrice` chỉ cộng món available.
- **Preconditions:** Catalog đã tải.
- **Postconditions:** `outfits` đã lọc/dedupe; sản phẩm bị xoá hoặc mã lạ bị loại.
- **Priority:** P0
- **Source:** `BE/src/modules/products/product-suggestion.service.ts:resolveOutfits:218`, `buildOutfits:323`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-095…AC-097

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-095 | Gemini trả mã không có trong catalog | Validate kết quả | Mã lạ bị loại; outfit rỗng bị bỏ; không trả sản phẩm bịa | Verified (TC-146) |
| AC-096 | Outfit có 2 top, hoặc dress + quần, hoặc 1 món không phải dress | Validate | Outfit bị loại; role chuẩn hoá top/bottom/outer/dress | Verified (TC-147) |
| AC-097 | Có món hết hàng | Hydrate | `available=false`; món hết hàng không cộng vào `totalPrice` | Verified (TC-148) |

## US-032 — Kết quả nhất quán, lặp lại không tốn quota

- **Actor:** USER
- **Story:** As a người dùng, I want gửi lại cùng yêu cầu và nhận lại kết quả cũ miễn phí, so that tôi không mất lượt vì bấm lại.
- **Description:** Cache theo user + hash ảnh + fingerprint catalog + input + prompt version; TTL; response hydrate theo giá/tên hiện tại.
- **Preconditions:** Có bản ghi cache còn hạn.
- **Postconditions:** `isCached=true`; không gọi provider, không tăng quota.
- **Priority:** P1
- **Source:** `BE/src/modules/stylist/stylist.service.ts:buildCacheKey:119`, `analyzeAndAdvise:179`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-098…AC-100

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-098 | Request thành công | Lưu kết quả | Có `inputContext`, `model`, `rawProviderResponse.text`, `cacheKey`, `expiresAt` | Verified (TC-149) |
| AC-099 | Cache còn hạn | Gửi lại cùng input | Cache hit đúng user; input/catalog/fingerprint khác thì miss; đổi số đo cũng phải miss | Verified một phần (TC-150, TC-152); hết hạn và số đo chưa chạy (TC-151, TC-177); số đo hiện bị bỏ qua (BUG-055) |
| AC-100 | Kết quả/cache có mã sản phẩm | Trả response | `outfits` top-level được hydrate tên/giá/ảnh/màu từ DB hiện tại | Verified (TC-153) |

## US-033 — Xem lại và xoá lịch sử

- **Actor:** USER
- **Story:** As a người dùng, I want xem lịch sử tư vấn và xoá từng kết quả, so that tôi quản lý dữ liệu cá nhân của mình.
- **Description:** Lịch sử mới nhất trước, phân trang, chỉ chủ sở hữu; xoá cứng.
- **Preconditions:** Đã có kết quả.
- **Postconditions:** List/detail trả dữ liệu đã hydrate; delete không còn row.
- **Priority:** P1
- **Source:** `BE/src/modules/stylist/stylist.service.ts:getUserHistory:725`, `findOwnedResult:775`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-101…AC-104

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-101 | Có N kết quả | `GET /history?page&limit` | Mới nhất trước; `limit` kẹp 1..100; `meta.totalPages` đúng | Verified (TC-162); phân trang chưa chạy (TC-161) |
| AC-102 | Trang có nhiều kết quả | Tải list | Chỉ một query sản phẩm cho cả trang; mọi item có `outfits` | Verified (TC-162) |
| AC-103 | Id thuộc user khác hoặc không tồn tại | `GET /history/:id` | 404; không trả dữ liệu người khác | Unverified (TC-163) |
| AC-104 | Id thuộc user | `DELETE /history/:id` | 200; row bị xoá cứng; id người khác 404 | Unverified (TC-164) |

## US-034 — Form và lỗi rõ ràng trên web

- **Actor:** USER
- **Story:** As a người dùng web, I want form chặn input thiếu và phản hồi lỗi/quota rõ ràng, so that tôi biết cần sửa gì.
- **Description:** Validate client song song BE; multipart chỉ gửi consent khi có ảnh; timeout 90 s; deep link `?result=`; lịch sử 5 mục/trang.
- **Preconditions:** Đang ở `/ai-stylist`.
- **Postconditions:** Không gửi request thiếu consent/context; lỗi hiển thị; URL khôi phục được kết quả.
- **Priority:** P1
- **Source:** `FE/src/features/stylist/services/stylist-utils.ts:validateStylistRequest:19`; `ai-stylist-page.tsx:handleAnalyze:110`
- **Confidence:** High (Code-verified)
- **Related AC:** AC-105…AC-108

| AC ID | Given | When | Then | Status |
|---|---|---|---|---|
| AC-105 | Không ảnh, không product/dịp/phong cách | Bấm Gửi | Không gọi API; toast lỗi yêu cầu thêm ngữ cảnh | Verified (TC-165) |
| AC-106 | Có ảnh nhưng chưa tick consent | Bấm Gửi | Không gọi API; báo cần xác nhận; `imageConsent` chỉ append khi có ảnh | Verified (TC-166, TC-167) |
| AC-107 | Quota = 0 hoặc BE trả 429 | Bấm Gửi / nhận lỗi | Mở `QuotaExhaustedModal`; không gửi request khi quota đã 0 (client) | Unverified (TC-169) |
| AC-108 | URL có `?result=<id>` | Mở trang | Kết quả được khôi phục; URL được chuẩn hoá bằng `replaceState`; xoá kết quả đang chọn đưa về idle | Unverified (TC-170) |
