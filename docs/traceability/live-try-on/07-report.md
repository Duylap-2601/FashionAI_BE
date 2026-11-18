# TR-001 — Test report & metrics — FLW-003 (live try-on)

Tính từ `04-test-cases.md` và `05-execution.md` (2026-11-18). Không dùng số test Jest làm mẫu số.

## 1. Chỉ số

| Chỉ số | Giá trị | Mẫu số |
|---|---|---|
| Test case thiết kế | 38 | TC-093…TC-130 |
| Đã chạy | 23 | Có `EXEC` |
| PASS | 23 | 16 BE + 7 FE |
| FAIL | 0 | — |
| BLOCKED | 0 | — |
| Not Run | 15 | Không tính pass |
| **Pass rate** | **100%** | 23 / (23 + 0) |
| **Execution rate** | **60,5%** | (23 + 0 + 0) / 38 |
| AC có ≥1 TC | 24 / 24 | AC-061…AC-084 |
| BR có ≥1 TC | 36 / 36 | BR-082…BR-117 |
| Defect | 9 | 6 Medium, 3 Low, 0 High/Critical |

## 2. Diễn giải

- 23 TC đã chạy là unit BE (mock Prisma/Decart) và render tĩnh FE; **không** chứng minh WebRTC, camera, provider token hay hành vi browser thật.
- Toàn bộ nhánh pause/end accounting, admin policy, ownership và beta allowlist là `Not Run`.
- 100% chỉ đúng cho tập đã chạy.

## 3. Defect

| Severity | Số | ID |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 6 | BUG-033…BUG-038 |
| Low | 3 | BUG-039…BUG-041 |

## 4. Khuyến nghị phát hành

- **Toàn workflow:** `Insufficient Evidence` — thiếu browser WebRTC + provider thật + staging multi-instance; 39,5% TC chưa chạy.
- **Beta nội bộ:** `Ready with Known Issues` nếu chấp nhận BUG-033…BUG-038; không dùng cho production vì pause/end accounting chưa được kiểm chứng ngoài unit.
- **Production:** `Not Ready` — cần tối thiểu TC-115/TC-116/TC-123/TC-124 trên staging và xác nhận chi phí/provider trước khi mở.

## 5. Điều kiện nâng mức

1. Chạy TC-095…TC-097, TC-100, TC-101, TC-109, TC-110, TC-115…TC-118, TC-123…TC-125, TC-130 trên staging với Decart thật.
2. Ghi `EXEC` mới cho từng lần chạy; giữ nguyên EXEC cũ.
3. Đóng BUG-034/035 (terminal state, slot) trước khi mở rộng đồng thời.
