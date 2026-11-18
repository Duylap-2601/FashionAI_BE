# Traceability — FLW-001 (BE + FE)

Bộ tài liệu truy vết end-to-end cho luồng thương mại chính của FashionAI:
**Đặt hàng → Thanh toán → Giao hàng → Đổi trả/Hoàn tiền**. Tài liệu được đặt trong
`FashionAI_BE/docs/` nhưng bao phủ cả `FashionAI_FE` và `FashionAI_BE`.

Sinh ngày 2026-11-18 từ source code; không sửa application code trong quá trình viết.

## Đọc theo thứ tự

| File | Nội dung |
|---|---|
| [`00-workflow.md`](00-workflow.md) | Phạm vi, actor, luồng chính/ngoại lệ, hệ thống, câu hỏi mở |
| [`01-user-stories.md`](01-user-stories.md) | 10 user story, 36 acceptance criterion |
| [`02-business-rules.md`](02-business-rules.md) | 43 business rule kèm điều kiện, ngoại lệ, điểm thực thi |
| [`03-screens-and-flows.md`](03-screens-and-flows.md) | 13 màn hình, component, 52 API |
| [`04-test-cases.md`](04-test-cases.md) | 6 test scenario, 50 test case |
| [`05-execution.md`](05-execution.md) | 17 execution record từ lần chạy unit test 2026-11-18 |
| [`06-defects.md`](06-defects.md) | 21 defect / defect candidate |
| [`07-report.md`](07-report.md) | Pass rate, execution rate, khuyến nghị phát hành |
| [`08-traceability-matrix.md`](08-traceability-matrix.md) | Ma trận US → AC → BR → SCR → TC → EXEC → BUG |
| [`09-audit.md`](09-audit.md) | Findings, mức độ, remediation, vòng lặp audit |

## Trạng thái hiện tại

| Chỉ số | Giá trị |
|---|---|
| Design coverage (BR có TC) | 43/43 = 100% |
| Design coverage (AC có TC) | 36/36 = 100% |
| Test case có execution | 17/50 = 34,0% |
| Pass rate (chỉ TC đã chạy) | 17/17 = 100% |
| Defect | 1 Critical, 1 High, 10 Medium, 9 Low |
| Khuyến nghị toàn workflow | **Insufficient Evidence** — 66% TC chưa chạy |
| Khuyến nghị luồng SePay | **Not Ready** — BUG-002 |

Không có kết quả test bị bịa: mọi `PASS` đều trỏ tới `EXEC` và tên test thật trong
`FashionAI_BE/test/unit/`.

## Quy ước ID

| Entity | Prefix | Entity | Prefix |
|---|---|---|---|
| Workflow | `FLW` | Test Scenario | `TS` |
| User Story | `US` | Test Case | `TC` |
| Acceptance Criterion | `AC` | Execution | `EXEC` |
| Business Rule | `BR` | Defect | `BUG` |
| Screen | `SCR` | Test Report | `TR` |
| Component | `CMP` | Open Question | `OQ` |
| API | `API` | | |

ID cấp một lần, không tái sử dụng sau khi xoá. Báo cáo hiện tại là `TR` trong
`07-report.md` (không cấp ID riêng để tránh trùng với lần chạy sau).

## Evidence class

- `Documented` — nêu trong SRS/ADR/plan.
- `Code-verified` — tìm thấy trong code, có neo `path:symbol:line`.
- `Inferred` — suy ra từ hành vi, chưa chạy.
- `Unknown` — không đủ bằng chứng.

## Bảo trì khi code/yêu cầu đổi

1. Tìm neo bị ảnh hưởng (`path:symbol:line`) trong `02`/`03`.
2. Xác định US/BR/AC bị tác động, rồi TC và metric liên quan.
3. Cập nhật đúng các dòng đó, **giữ nguyên ID**.
4. Thêm `EXEC` mới cho lần chạy mới; không sửa `EXEC` cũ.
5. Chạy lại ma trận và ghi finding mới vào `09-audit.md` trước khi đóng.

## Phạm vi ngoài bộ tài liệu

- Mua gói thành viên dùng chung `Order` + webhook nhưng có vòng đời riêng (OQ-004).
- Auth, hồ sơ số đo, try-on, stylist, chatbot, avatar.
- Hạ tầng deploy, CI, backup.
