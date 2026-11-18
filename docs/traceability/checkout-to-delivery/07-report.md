# TR-001 — Test Report & Metrics — FLW-001

Báo cáo tính từ `04-test-cases.md` (thiết kế) và `05-execution.md` (lần chạy thật duy nhất).
Không dùng số lượng test case làm tỷ lệ pass. Mọi % đều ghi rõ mẫu số.

## 1. Phạm vi và giới hạn bằng chứng

| Hạng mục | Giá trị |
|---|---|
| Workflow | FLW-001 — Đặt hàng → Thanh toán → Giao hàng → Đổi trả/Hoàn tiền |
| Lần chạy | 2026-11-18, Jest unit, Node 22.22.0, BE `1f6319c` + working tree |
| Loại bằng chứng | Unit test có mock; **không** có E2E, không có UI, không có cổng sandbox, không có GHN thật |
| Tổng suite / test | 18 suite / 103 test — 103 PASS, 0 FAIL |
| Test case thiết kế | 50 (TC-001 … TC-050) |
| Test case có execution | 17 |
| Test case `Not Run` | 33 |

## 2. Chỉ số thiết kế

| Chỉ số | Công thức | Giá trị |
|---|---|---|
| Design coverage — User Story | US có ≥1 AC / 10 | 10/10 = 100% |
| Design coverage — AC | AC có ≥1 TC / 36 | 36/36 = 100% |
| Design coverage — Business Rule | BR có ≥1 TC hoặc `Unknown` / 43 | 43/43 = 100% |
| Design coverage — Screen | SCR có US/BR / 13 | 13/13 = 100% |
| Test case có link yêu cầu | TC có US/AC/BR / 50 | 50/50 = 100% |

## 3. Chỉ số thực thi

```
Pass Rate        = Passed / (Passed + Failed) × 100
                 = 17 / (17 + 0) × 100 = 100%        (mẫu số: 17 TC đã chạy)
Execution Rate   = (Passed + Failed + Blocked) / Total TC × 100
                 = (17 + 0 + 0) / 50 × 100 = 34,0%   (mẫu số: 50 TC thiết kế)
Not Run          = 33 / 50 = 66,0%
```

`Not Run` và `Skipped` không được tính là Passed. 100% pass rate **chỉ** nói về 17 TC
unit-level đã chạy; không đại diện cho UI, webhook thật hay cổng thanh toán.

## 4. Phân bổ theo khu vực

| Khu vực | TC | Đã chạy | Pass | Not Run |
|---|---|---|---|---|
| Giá & báo giá (TS-001) | 5 | 2 | 2 | 3 |
| Vòng đời đơn (TS-002) | 5 | 1 | 1 | 4 |
| Thanh toán (TS-003) | 7 | 3 | 3 | 4 |
| Vận chuyển (TS-004) | 7 | 5 | 5 | 2 |
| Đổi trả/hoàn tiền (TS-005) | 12 | 5 | 5 | 7 |
| UI/quyền/dữ liệu (TS-006) | 7 | 1 | 1 | 6 |
| Bổ sung (TC-044…050) | 7 | 0 | 0 | 7 |
| **Tổng** | **50** | **17** | **17** | **33** |

## 5. Defect summary

| Severity | Số lượng | ID |
|---|---|---|
| Critical | 1 | BUG-002 |
| High | 1 | BUG-001 |
| Medium | 10 | BUG-003, BUG-004, BUG-005, BUG-006, BUG-008, BUG-010, BUG-012, BUG-014, BUG-015, BUG-017 |
| Low | 9 | BUG-007, BUG-009, BUG-011, BUG-013, BUG-016, BUG-018, BUG-019, BUG-020, BUG-021 |
| **Tổng** | **21** | – |

Trong đó `Open` (bằng chứng code path) 17 — gồm 2 mục ghi chú “có thể chủ đích/không phải
lỗ hổng” (BUG-005, BUG-013); `Defect candidate` (cần chạy staging) 4 — BUG-006, BUG-010,
BUG-015, BUG-017.

Defect chặn release theo luồng:

- **BUG-002** — SePay checkout dùng `ORD-` nhưng IPN/bank webhook chỉ parse `FAI`: mọi
  thanh toán SePay có nguy cơ kẹt `CREATED` và rơi vào `PARSE_FAILED`. Ảnh hưởng trực tiếp
  AC-011 (US-003).
- **BUG-001** — tài liệu SRS vẫn cam kết COD/trừ kho; nếu SRS là hợp đồng nghiệm thu thì
  phạm vi release sai.

## 6. Khuyến nghị phát hành (theo bằng chứng)

| Phạm vi | Khuyến nghị | Lý do |
|---|---|---|
| Luồng ZaloPay | **Insufficient Evidence** | 17/50 TC có bằng chứng, chỉ unit; chưa chạy callback MAC, chưa chạy UI |
| Luồng SePay checkout | **Not Ready** | BUG-002 Critical, chưa có test hồi quy |
| Luồng đổi trả/hoàn tiền | **Ready with Known Issues** (phần tính toán) | Toán tiền hàng/phí ship/rollup đã có 5 TC PASS; gate COMPLETED/RETURNED và reopen refund chưa chạy |
| Vận hành GHN | **Ready with Known Issues** | Hủy vận đơn, webhook secret, ánh xạ trạng thái đã có test; hủy vận đơn không đồng bộ đơn (BUG-012) |
| Toàn workflow | **Insufficient Evidence** | 66% TC `Not Run`; không có E2E/UI execution |

## 7. Việc cần làm để nâng mức bằng chứng

1. Thêm test cho BUG-002 (cả IPN và bank webhook với `ORD-`/`FAI`).
2. Chạy E2E staging: TC-016 (PAID side effects), TC-023/024 (delivery/dispute), TC-025/026
   (issue), TC-032 (reopen refund), TC-037…TC-040 (UI).
3. Đặt `GHN_WEBHOOK_SECRET`, `PAYMENT_DEFAULT_PROVIDER`, `SEPAY_*` trong staging trước khi chạy.
4. Có execution record cho 33 TC còn lại rồi tính lại Pass Rate/Execution Rate; giữ nguyên
   `EXEC` cũ, thêm `EXEC` mới cho lần chạy lại.
