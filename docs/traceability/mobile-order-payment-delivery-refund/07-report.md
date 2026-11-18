# TR-001 — Test report & metrics — FLW-002 (mobile)

Báo cáo tính từ `04-test-cases.md` (thiết kế) và `05-execution.md` (lần chạy 2026-11-18). Không dùng số test của Jest làm mẫu số; mẫu số là test case của workflow.

## 1. Phạm vi đã đo

| Chỉ số | Giá trị | Mẫu số / ghi chú |
|---|---|---|
| Test case thiết kế | 42 | TC-051…TC-092 |
| Test case đã chạy | 21 | Có `EXEC` trong `05-execution.md` |
| PASS | 21 | 13 suite / 109 test Jest cùng pass |
| FAIL | 0 | — |
| BLOCKED | 0 | — |
| Not Run | 21 | Không tính vào pass rate |
| **Pass rate** | **100%** | 21 / (21 + 0) |
| **Execution rate** | **50,0%** | (21 + 0 + 0) / 42 |
| AC có ≥1 TC | 24 / 24 | AC-037…AC-060 |
| BR có ≥1 TC | 38 / 38 | BR-044…BR-081 |
| Defect | 11 | 4 High, 2 Medium, 5 Low, 0 Critical |

## 2. Diễn giải

- Toàn bộ 21 TC đã chạy là unit/contract với axios mock và render tĩnh; **không** chứng minh hành vi trên thiết bị, cổng thanh toán thật, GHN hay push.
- 21 TC còn `Not Run` tập trung đúng vào nơi rủi ro nhất: UI component, WebView/deep link, poll trạng thái thanh toán, gate số đo, và nhánh lỗi.
- `100%` pass chỉ đúng cho tập đã chạy; không được đọc là “flow mobile đã pass 100%”.

## 3. Defect theo severity

| Severity | Số | ID | Ảnh hưởng chính |
|---|---|---|---|
| Critical | 0 | — | — |
| High | 4 | BUG-022, BUG-023, BUG-024, BUG-025 | Sai xác nhận thanh toán; tạo đơn trùng; bỏ gate số đo; payload/tổng giỏ lệch |
| Medium | 2 | BUG-026, BUG-027 | Báo thất bại sai sau timeout; báo chưa nhận tiền hoàn sai item |
| Low | 5 | BUG-028…BUG-032 | Scheme, trần số lượng, cửa sổ 7 ngày, tracking, quyền ảnh |

## 4. Khuyến nghị phát hành

- **Toàn workflow:** `Insufficient Evidence` — chưa có E2E/device test, chưa chạy cổng thật; 50% TC chưa chạy.
- **Luồng thanh toán đơn (SePay/ZaloPay):** `Not Ready` — BUG-022 (server-authoritative bị thay bằng URL heuristic) và BUG-023 (không idempotent) phải đóng trước khi phát hành.
- **Luồng đổi trả/hoàn tiền:** `Ready with Known Issues` ở mức unit (window/validation/refund rules có test pass), nhưng UI form và confirm trên thiết bị vẫn `Not Run`.

## 5. Điều kiện để nâng mức

1. Chạy TC-053…TC-056, TC-060, TC-062, TC-063, TC-065…TC-067, TC-069…TC-071, TC-085, TC-086, TC-088…TC-092 trên staging với cổng sandbox + đơn GHN thật.
2. Ghi `EXEC` mới (không sửa `EXEC` cũ) cho từng TC sau khi chạy.
3. Đóng BUG-022/023/024/025 hoặc chấp nhận rủi ro có chữ ký release.
