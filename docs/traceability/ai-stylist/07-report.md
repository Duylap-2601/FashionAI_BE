# TR-002 — Test report & metrics — FLW-004 (AI Stylist)

Tính từ `04-test-cases.md` (47 TC) và `05-execution.md` (32 EXEC), ngày 2026-11-18. Không dùng số test Jest làm mẫu số.

## 1. Chỉ số thực thi

| Chỉ số | Giá trị | Mẫu số |
|---|---:|---|
| Test case thiết kế | 47 | TC-131…TC-177 |
| Đã chạy (có EXEC) | 32 | 47 TC |
| PASS | 32 | 32 đã chạy |
| FAIL | 0 | 32 đã chạy |
| Not Run | 15 | 47 TC |
| Pass Rate | **100,0%** | 32 / (32 + 0) |
| Execution Rate | **68,1%** | (32 + 0 + 0) / 47 |
| Design coverage | 38/38 BR; 24/24 AC | BR/AC trong phạm vi |
| Execution coverage | 32/47 TC | toàn bộ TC |

`100%` chỉ nghĩa là mọi test **đã chạy** đều pass; 15 test chưa chạy không được tính là coverage.

## 2. Theo nhóm

| Nhóm | TC | PASS | Not Run |
|---|---:|---:|---:|
| Truy cập & quota | 6 | 4 | 2 (TC-132, TC-175) |
| Consent & ảnh | 5 | 4 | 1 (TC-139) |
| Sản phẩm neo & catalog | 9 | 7 | 2 (TC-142, TC-176) |
| Lưu, cache, response | 6 | 4 | 2 (TC-151, TC-177) |
| Parse & lỗi provider | 7 | 5 | 2 (TC-159, TC-160) |
| Lịch sử | 4 | 1 | 3 (TC-161, TC-163, TC-164) |
| Web FE | 10 | 7 | 3 (TC-168, TC-169, TC-170) |

## 3. Defect

| Severity | Số | Đã đóng |
|---|---:|---:|
| Critical | 0 | 0 |
| High | 2 | 0 |
| Medium | 4 | 0 |
| Low | 10 | 0 |
| **Tổng** | **16** | **0** |

- **BUG-042 (High):** quota check-then-act cho phép vượt hạn mức khi request đồng thời → rủi ro chi phí và sai số liệu.
- **BUG-055 (High):** cache key bỏ qua số đo → tư vấn cũ tới 30 ngày.
- 4 Medium: lộ internals trong history; cache/row không purge; modal quota mất chi tiết; resolver không chặn dress+quần/hai top.
- 10 Low: thông điệp lỗi, validate file FE, nhãn dịp, CTA sai route, id fallback, pagination, contract drift, blob URL, lỗi tải im lặng.

## 4. Bằng chứng & giới hạn

- BE: 54 test stylist-specific (18 service + 6 controller + 4 e2e + 11 product-suggestion + 10 quota.service + 5 quota.guard) đều PASS, mock Prisma/Gemini.
- FE: 8 test outfit + 1 test legacy list stylist trong `error-handling` PASS; **không có** test hook/component (không có RTL).
- Không chạy Gemini thật, Postgres/Redis thật, browser, upload ảnh thật; không chứng minh prompt tạo outfit đúng ngoài đời.

## 5. Khuyến nghị phát hành

**Not Ready** cho production:
1. Đóng BUG-042 (reserve quota atomic) và BUG-055 (đưa số đo vào cache key) — High.
2. Chạy 15 TC `Not Run`, tối thiểu TC-163/164 (ownership), TC-161 (pagination), TC-169 (modal quota), TC-175 (401), TC-177 (cache số đo) trên staging.
3. Chạy 1 smoke test provider thật + 1 browser test cho luồng submit/restore.
4. Xử lý BUG-043/044 trước khi mở rộng người dùng (privacy/retention).

Điều kiện "Ready with Known Issues" chỉ sau khi BUG-042/055 đóng và nhóm Low được chấp nhận có văn bản.
