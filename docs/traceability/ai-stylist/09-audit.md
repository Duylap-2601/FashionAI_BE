# Audit — FLW-004 (AI Stylist)

## 1. Findings

| Severity | Check | Finding | Evidence | Required action |
|---|---|---|---|---|
| High | Consistency | Quota check-then-act không atomic; 2 request đồng thời vượt hạn mức | BUG-042; `quota.guard.ts:44-52`; `stylist.service.ts:209-249` | Reserve slot atomic trước provider + test đồng thời |
| High | Consistency | Cache key bỏ qua số đo; đổi số đo vẫn nhận tư vấn cũ tới 30 ngày | BUG-055; `buildCacheKey:119-138` | Đưa measurements/version vào key; test TC-177 |
| High | Forward | 15/47 TC `Not Run`, gồm ownership, pagination, quota modal, cache số đo, 401; không có Gemini/Postgres/browser thật | `05-execution.md` | Chạy staging + provider thật trước release |
| Medium | Backward | History trả `userId/cacheKey/humanImageHash/rawProviderResponse` | BUG-043; `getUserHistory:748-752` | Response DTO, bỏ internals |
| Medium | Consistency | Row/cache stylist hết hạn không purge; raw provider text giữ vô thời hạn | BUG-044; `maintenance.service.ts:42` | Retention/purge job |
| Medium | Backward | Modal 429 không dùng `remaining/resetAt` BE trả | BUG-045; `ai-stylist-page.tsx:219` | Truyền error details; test component |
| Medium | Intent | Resolver không chặn dress+quần / hai top dù rule nói phải chặn | BUG-056; `resolveOutfits:218-253` | Validate role set sau provider |
| Low | Consistency | FE gộp 400/503/500 thành một toast | BUG-046 | Map status/code |
| Low | Forward | Không validate MIME/size ảnh phía FE | BUG-047 | Chặn trước upload |
| Low | Consistency | `page` không validate, có thể 500 | BUG-051; `getUserHistory:725-727` | ParseInt + clamp |
| Low | Consistency | Contract FE/BE lệch `garmentDescription`/`recommendedSize` | BUG-052 | Xoá field chết hoặc bổ sung |
| Low | Intent | CTA "Hỏi AI Stylist" trỏ `/chat`; fallback id `p1…p6` không phải UUID | BUG-049, BUG-050 | Sửa route/id |
| Low | Consistency | Lỗi quota/history ở trang chính bị bỏ qua; nhãn dịp không khớp; blob URL không revoke | BUG-048, BUG-053, BUG-054 | Sửa UI/cleanup |
| Low | Intent | Sản phẩm neo INACTIVE được nhận và mất ràng buộc anchor | BUG-057; `getProductContext:286-293` | Lọc ACTIVE hoặc 400 |

## 2. Kiểm tra hai chiều

| Hướng | Kết quả |
|---|---|
| US→AC | 8/8 US có AC testable; 24 AC |
| AC→BR | 24/24 AC ánh xạ ít nhất một BR |
| BR→TC | 38/38 BR có TC; không có BR mồ côi |
| TC→BR | 47/47 TC có link; không có test mồ côi |
| TC→EXEC | 32/47 có EXEC; 15 `Not Run` được liệt kê, không tính PASS |
| BUG→BR/TC | 16/16 defect candidate có link |
| ID | Không trùng; BR-118…BR-155, TC-131…TC-177, BUG-042…BUG-057, EXEC-062…EXEC-093 |

## 3. Điểm lệch có chủ đích (không tự sửa requirement theo code)

- BR-133 (cấu trúc outfit) và BR-140 (cache key) đã hạ `Enforced` xuống `partial/no` và mở BUG-055/056 thay vì viết lại rule cho khớp code.
- BR-128/131 giữ yêu cầu "neo phải là sản phẩm bán được"; code chấp nhận INACTIVE → BUG-057.
- History over-exposure là lỗi triển khai, không phải đặc tả; BR-139/146 giữ nguyên.

## 4. Open questions

| ID | Câu hỏi | Ảnh hưởng | Đề xuất |
|---|---|---|---|
| OQ-018 | Chấp nhận vượt quota nhỏ do concurrency hay bắt buộc reserve atomic? | Chi phí, fairness | Reserve atomic; rollback khi provider lỗi |
| OQ-019 | Sản phẩm INACTIVE có được làm neo (để tư vấn món user đang có) hay phải 404? | Hành vi sản phẩm | 404 + cho chọn món tương tự |
| OQ-020 | Raw provider text giữ bao lâu? Có cần cho audit/hỗ trợ không? | Privacy, storage | TTL 30–90 ngày, tách khỏi cache |
| OQ-021 | Số đo đổi có nên vô hiệu cache ngay? | Chất lượng tư vấn | Có; version/hash measurements trong key |
| OQ-022 | Có cần hiển thị chi tiết lỗi provider cho user? | UX vs bảo mật | Chỉ mã lỗi + hướng dẫn; chi tiết vào log |
| OQ-023 | Timeout/abort provider phía server là bao nhiêu? FE 90 s không huỷ server | Chi phí, treo request | Đặt timeout SDK + abort; khớp FE |

## 5. Kết luận audit

- Không có Critical; 2 High defect + 1 High bằng chứng thiếu.
- Không thể tuyên bố coverage đầy đủ: 32 test chạy đều mock provider; 15 TC chưa chạy.
- Đã giữ toàn bộ ID và lịch sử execution; không sửa code ứng dụng.
- Release: **Not Ready** (xem `07-report.md`).
