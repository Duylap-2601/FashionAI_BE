# Requirements Traceability Matrix — FLW-001

Ma trận chính: mỗi AC là một dòng, nối ngược về US/BR/screen và xuôi tới TC/EXEC/BUG.
`–` nghĩa là chưa có execution hoặc không có defect tương ứng.

## 1. Ma trận chính (US → AC → BR → Screen → TC → EXEC → BUG)

| US | AC | BR | SCR | TC | EXEC | BUG |
|---|---|---|---|---|---|---|
| US-001 | AC-001 | BR-043 | SCR-001 | TC-037 | – | – |
| US-001 | AC-002 | BR-043 | SCR-001 | TC-037 | – | – |
| US-001 | AC-003 | BR-023, BR-043 | SCR-001 | TC-016 | – | – |
| US-002 | AC-004 | BR-001, BR-002, BR-006, BR-007, BR-008 | SCR-002 | TC-001, TC-004, TC-045 | EXEC-001 | BUG-009, BUG-018 |
| US-002 | AC-005 | BR-003 | SCR-002, SCR-007 | TC-009 | – | – |
| US-002 | AC-006 | BR-004, BR-005 | SCR-002 | TC-005 | – | – |
| US-002 | AC-007 | BR-001 | SCR-002 | TC-004 | – | – |
| US-002 | AC-008 | BR-011 | SCR-002 | TC-002 | EXEC-002 | – |
| US-002 | AC-036 | BR-013 | SCR-007 | TC-007 | – | BUG-006 |
| US-003 | AC-009 | BR-010, BR-016 | SCR-002, SCR-003 | TC-046, TC-047 | – | BUG-001 |
| US-003 | AC-010 | BR-016 | SCR-002, SCR-003 | TC-013 | – | – |
| US-003 | AC-011 | BR-017, BR-018, BR-021, BR-022 | SCR-003, SCR-004 | TC-014, TC-015, TC-016 | – | BUG-002, BUG-008, BUG-021 |
| US-003 | AC-011 | BR-014, BR-021 | SCR-005 | TC-040 | – | BUG-008 |
| US-003 | AC-012 | BR-019 | SCR-004 | TC-011 | EXEC-004 | BUG-015 |
| US-003 | AC-013 | BR-019 | SCR-004, SCR-005 | TC-011 | EXEC-004 | BUG-006, BUG-020 |
| US-003 | AC-013 | BR-019, BR-021, BR-036 | SCR-004 | TC-043 | – | – |
| US-003 | AC-034 | BR-012 | SCR-007 | TC-006 | EXEC-003 | BUG-004 |
| US-003 | AC-035 | BR-020 | SCR-003 | TC-012 | EXEC-005 | BUG-011 |
| US-004 | AC-014 | BR-002, BR-014 | SCR-006, SCR-007 | TC-048 | – | BUG-008 |
| US-004 | AC-015 | BR-024 | SCR-007, SCR-010 | TC-010 | – | – |
| US-004 | AC-016 | BR-014 | SCR-007 | TC-008 | – | BUG-003 |
| US-005 | AC-017 | BR-029 | SCR-007 | TC-023 | – | – |
| US-005 | AC-018 | BR-030 | SCR-007 | TC-024 | – | – |
| US-005 | AC-019 | BR-027, BR-028 | SCR-011 | TC-022 | EXEC-011 | BUG-014, BUG-017 |
| US-006 | AC-020 | BR-031 | SCR-008 | TC-025 | – | – |
| US-006 | AC-021 | BR-032 | SCR-008 | TC-026 | – | BUG-016 |
| US-006 | AC-022 | BR-032 | SCR-008 | TC-026 | – | – |
| US-007 | AC-023 | BR-033, BR-034 | SCR-008, SCR-010 | TC-027, TC-028 | EXEC-012, EXEC-013 | BUG-010 |
| US-007 | AC-024 | BR-035, BR-036 | SCR-010 | TC-029, TC-030 | EXEC-014, EXEC-015 | – |
| US-007 | AC-025 | BR-037 | SCR-008 | TC-032 | – | – |
| US-008 | AC-026 | BR-014, BR-015, BR-042 | SCR-009, SCR-010 | TC-008, TC-041 | EXEC-017 | BUG-005, BUG-007 |
| US-008 | AC-026 | BR-042 | SCR-009 | TC-042 | – | – |
| US-008 | AC-027 | BR-025 | SCR-010 | TC-049 | – | BUG-019 |
| US-008 | AC-028 | BR-026 | SCR-011 | TC-019 | EXEC-008 | BUG-012 |
| US-009 | AC-029 | BR-038 | SCR-013 | TC-033 | – | – |
| US-009 | AC-030 | BR-035, BR-039 | SCR-010 | TC-034, TC-050 | – | – |
| US-009 | AC-031 | BR-038 | SCR-013 | TC-033 | – | – |
| US-010 | AC-032 | BR-041, BR-042 | SCR-012 | TC-036 | – | BUG-013 |
| US-010 | AC-033 | BR-040 | SCR-012 | TC-035 | – | – |

## 2. Ma trận BR → TC (kiểm tra phủ sóng)

| BR | TC | Trạng thái |
|---|---|---|
| BR-001 | TC-004 | Not Run |
| BR-002 | TC-044 | Not Run |
| BR-003 | TC-009 | Not Run |
| BR-004 | TC-005 | Not Run |
| BR-005 | TC-005 | Not Run |
| BR-006 | TC-003 | Not Run |
| BR-007 | TC-001 | PASS (EXEC-001) |
| BR-008 | TC-045 | Not Run |
| BR-009 | TC-013, TC-038 | Not Run |
| BR-010 | TC-046 | Not Run |
| BR-011 | TC-002 | PASS (EXEC-002) |
| BR-012 | TC-006 | PASS (EXEC-003) |
| BR-013 | TC-007 | Not Run |
| BR-014 | TC-008, TC-041 | PASS (EXEC-017) + Not Run |
| BR-015 | TC-008 | Not Run |
| BR-016 | TC-013, TC-047 | Not Run |
| BR-017 | TC-014 | Not Run |
| BR-018 | TC-015, TC-047 | Not Run |
| BR-019 | TC-011 | PASS (EXEC-004) |
| BR-020 | TC-012 | PASS (EXEC-005) |
| BR-021 | TC-016 | Not Run |
| BR-022 | TC-016, TC-017 | PASS (EXEC-006, chỉ outbox) |
| BR-023 | TC-016 | Not Run |
| BR-024 | TC-010 | Not Run |
| BR-025 | TC-018, TC-049 | PASS (EXEC-007) + Not Run |
| BR-026 | TC-019 | PASS (EXEC-008) |
| BR-027 | TC-020, TC-021 | PASS (EXEC-009, EXEC-010) |
| BR-028 | TC-022 | PASS (EXEC-011) |
| BR-029 | TC-023 | Not Run |
| BR-030 | TC-024 | Not Run |
| BR-031 | TC-025 | Not Run |
| BR-032 | TC-026 | Not Run |
| BR-033 | TC-027 | PASS (EXEC-012) |
| BR-034 | TC-028 | PASS (EXEC-013) |
| BR-035 | TC-029, TC-030, TC-050 | PASS (EXEC-014, EXEC-015) + Not Run |
| BR-036 | TC-031 | PASS (EXEC-016) |
| BR-037 | TC-032 | Not Run |
| BR-038 | TC-033 | Not Run |
| BR-039 | TC-034 | Not Run |
| BR-040 | TC-035 | Not Run |
| BR-041 | TC-036 | Not Run |
| BR-042 | TC-039, TC-008 | Not Run |
| BR-043 | TC-037 | Not Run |

## 3. Kiểm tra hai chiều

### Forward (yêu cầu → thực thi)

- 10/10 US có AC; 36/36 AC có ≥1 TC; 43/43 BR có TC; 13/13 SCR có US/BR.
- 17/50 TC có execution. Các AC `Verified`: AC-012, AC-013, AC-019, AC-023, AC-028,
  AC-034. Các AC còn lại `Unverified`.
- Không có AC nào `Verified` mà thiếu `EXEC`; không có `EXEC` nào không gắn TC.

### Backward (test/defect → yêu cầu)

- 50/50 TC có link US/AC/BR.
- 21/21 BUG có `Related` trỏ về US/BR/SCR hoặc ghi rõ là vấn đề tài liệu/cấu trúc.
- Không có test/defect mồ côi.

### Consistency

- ID không trùng, không tái sử dụng. `EXEC` chỉ tạo cho lần chạy 2026-11-18; không sửa lịch sử.
- 6 AC `Verified` khớp đúng 7 `EXEC` evidence rows (EXEC-004 phủ 2 AC).
- `BR-014` có 2 TC nhưng chỉ TC-041 được chạy; ma trận ghi rõ phần nào đã chứng minh.

### Intent vs code

- 4 mâu thuẫn tài liệu/code: BUG-001 (COD/kho), BUG-019 (tự tạo vận đơn), BUG-007
  (trạng thái chết), BUG-008 (trang success giả). Tất cả giữ nguyên yêu cầu tài liệu và
  ghi discrepancy, không sửa yêu cầu theo code.
