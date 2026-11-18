# TR-002 — Test report & metrics — FLW-004 (AI Stylist)

Tính từ `04-test-cases.md` (47 TC) và `05-execution.md` (47 EXEC), ngày 2026-11-18. Không dùng số test Jest làm mẫu số.

## 1. Chỉ số thực thi

| Chỉ số | Giá trị | Mẫu số |
|---|---:|---|
| Test case thiết kế | 47 | TC-131…TC-177 |
| Đã chạy (có EXEC) | 47 | 47 TC |
| PASS | 47 | 47 đã chạy |
| FAIL | 0 | 47 đã chạy |
| Not Run | 0 | 47 TC |
| Pass Rate | **100,0%** | 47 / 47 |
| Execution Rate | **100,0%** | 47 / 47 |
| Design coverage | 38/38 BR; 24/24 AC | BR/AC trong phạm vi |
| Execution coverage | 47/47 TC | toàn bộ TC |

Cập nhật 2026-11-18: 15 TC còn lại đã có EXEC (EXEC-101…115). `100%` vẫn chỉ khẳng định trên mock Prisma/Gemini/Redis — chưa phải staging thật.

## 2. Theo nhóm

| Nhóm | TC | PASS | Not Run |
|---|---:|---:|---:|
| Truy cập & quota | 6 | 6 | 0 |
| Consent & ảnh | 5 | 5 | 0 |
| Sản phẩm neo & catalog | 9 | 9 | 0 |
| Lưu, cache, response | 6 | 6 | 0 |
| Parse & lỗi provider | 7 | 7 | 0 |
| Lịch sử | 4 | 4 | 0 |
| Web FE | 10 | 10 | 0 |

## 3. Defect

| Severity | Số | Đã đóng |
|---|---:|---:|
| Critical | 0 | 0 |
| High | 2 | 2 |
| Medium | 4 | 4 |
| Low | 10 | 10 |
| **Tổng** | **16** | **16** |

Cập nhật 2026-11-18: cả 16 defect đã có fix trong code + test hồi quy (chi tiết ở `06-defects.md` mục *Fix*).

- **BUG-042 (High):** quota check-then-act cho phép vượt hạn mức khi request đồng thời → rủi ro chi phí và sai số liệu.
- **BUG-055 (High):** cache key bỏ qua số đo → tư vấn cũ tới 30 ngày.
- 4 Medium: lộ internals trong history; cache/row không purge; modal quota mất chi tiết; resolver không chặn dress+quần/hai top.
- 10 Low: thông điệp lỗi, validate file FE, nhãn dịp, CTA sai route, id fallback, pagination, contract drift, blob URL, lỗi tải im lặng.

## 4. Bằng chứng & giới hạn

- BE: 68 unit test stylist-specific PASS (stylist.service 27, controller 6, product-suggestion 12, quota.service 18, quota.guard 5) + 2 file-validation; e2e `stylist-analyze` 6 + `stylist-auth` 4 PASS. Mock Prisma/Gemini/Redis.
- FE: 14 test stylist-specific (`outfit-suggestions` + `error-handling`) PASS; **không có** test render component (không có RTL) — logic quota-gate/error/deep-link được tách ra service để test.
- Không chạy Gemini thật, Postgres/Redis thật, browser, upload ảnh thật; không chứng minh prompt tạo outfit đúng ngoài đời.

## 5. Khuyến nghị phát hành

**Not Ready** cho production (đã cập nhật 2026-11-18):
1. ~~Đóng BUG-042 và BUG-055~~ — đã sửa trong code, có test hồi quy.
2. ~~Chạy 15 TC `Not Run`~~ — đã chạy toàn bộ 47 TC trên mock (EXEC-101…115).
3. Còn lại: 1 smoke test provider thật + 1 browser test cho luồng submit/restore trên staging.
4. ~~Xử lý BUG-043/044~~ — đã sửa (DTO history + purge job), cần xác nhận retention trên staging.

Điều kiện "Ready with Known Issues": chỉ còn phụ thuộc bước 3 (provider thật + browser trên staging).
