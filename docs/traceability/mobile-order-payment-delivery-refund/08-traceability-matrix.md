# Ma trận truy vết — FLW-002 (mobile)

Mỗi dòng là một business rule; AC/TC liên quan có thể lặp (một rule phục vụ nhiều AC). `—` = chưa có execution, không phải đã pass.

| US | AC | BR | SCR/FLW | TC | EXEC | BUG |
|---|---|---|---|---|---|---|
| US-011 | AC-037 | BR-044 | SCR-017, SCR-018 | TC-051, TC-052 | EXEC-018, EXEC-019 | — |
| US-011 | AC-037, AC-039 | BR-045 | SCR-018 | TC-053 | — | — |
| US-011 | AC-037, AC-039 | BR-046 | SCR-018 | TC-054 | — | — |
| US-011 | AC-038 | BR-047 | SCR-018 | TC-055 | — | BUG-024 |
| US-011 | AC-037 | BR-048 | SCR-018 | TC-090 | — | — |
| US-011 | AC-037 | BR-049 | SCR-018 | TC-056 | — | — |
| US-011 | AC-037 | BR-050 | SCR-018 | TC-052 | EXEC-019 | — |
| US-011 | AC-037 | BR-051 | SCR-018 | TC-061 | EXEC-022 | — |
| US-011 | AC-039 | BR-052 | SCR-018 | TC-060 | — | — |
| US-011 | AC-039 | BR-053 | SCR-018 | TC-058 | — | BUG-023 |
| US-012 | AC-040 | BR-054 | SCR-019 | TC-060 | — | — |
| US-012 | AC-040 | BR-055 | SCR-018, SCR-019 | TC-059, TC-060 | EXEC-021 | — |
| US-012 | AC-040, AC-042 | BR-056 | SCR-019 | TC-063, TC-089 | — | BUG-022 |
| US-012 | AC-040 | BR-057 | SCR-019 | TC-062 | — | — |
| US-012 | AC-040, AC-041 | BR-058 | SCR-019, SCR-021 | TC-064, TC-073 | EXEC-023, EXEC-026 | — |
| US-012 | AC-041 | BR-059 | SCR-019 | TC-064 | EXEC-023 | — |
| US-012 | AC-042 | BR-060 | SCR-019 | TC-065 | — | — |
| US-012 | AC-042 | BR-061 | SCR-024 | TC-066 | — | BUG-026 |
| US-012 | AC-042 | BR-062 | SCR-024 | TC-067 | — | — |
| US-012 | AC-042 | BR-063 | SCR-024 | TC-091 | — | — |
| US-013 | AC-043 | BR-064 | SCR-020 | TC-068 | EXEC-024 | — |
| US-013 | AC-044 | BR-065 | SCR-021 | TC-069 | — | — |
| US-013, US-014, US-015 | AC-046, AC-047, AC-048 | BR-066 | SCR-020, SCR-021 | TC-070, TC-074 | EXEC-027 | — |
| US-015 | AC-049 | BR-067 | SCR-021 | TC-071 | — | — |
| US-015 | AC-050 | BR-068 | SCR-021 | TC-092 | — | — |
| US-013 | AC-045 | BR-069 | SCR-021 | TC-072 | EXEC-025 | BUG-031 |
| US-016 | AC-051, AC-052 | BR-070 | SCR-021, SCR-022 | TC-075 | EXEC-028 | — |
| US-016 | AC-051 | BR-071 | SCR-022 | TC-077 | EXEC-030 | — |
| US-016 | AC-053 | BR-072 | SCR-022 | TC-078, TC-083 | EXEC-031, EXEC-036 | — |
| US-016 | AC-054 | BR-073 | SCR-022 | TC-076, TC-086 | EXEC-029 | BUG-032 |
| US-017 | AC-056, AC-057 | BR-074 | SCR-022 | TC-079 | EXEC-032 | BUG-030 |
| US-017 | AC-055 | BR-075 | SCR-021 | TC-084 | EXEC-037 | — |
| US-017 | AC-055, AC-056 | BR-076 | SCR-022 | TC-080, TC-081 | EXEC-033, EXEC-034 | — |
| US-017 | AC-057 | BR-077 | SCR-023 | TC-082 | EXEC-035 | — |
| US-011…US-018 | AC-037…AC-060 | BR-078 | SCR-017…SCR-025 | TC-088 | — | — |
| US-018 | AC-058…AC-060 | BR-079 | SCR-025 | TC-087 | EXEC-038 | — |
| US-012 | AC-040 | BR-080 | SCR-019 | TC-089 | — | BUG-028 |
| US-011 | AC-039 | BR-081 | SCR-018 | TC-057 | EXEC-020 | — |

## Kiểm tra hai chiều

- **Forward:** 8 US → 24 AC → 38 BR → 9 SCR → 42 TC. Mọi BR có ít nhất một TC; mọi AC có ít nhất một BR.
- **Backward:** không có TC mồ côi; 21 TC có `EXEC`, 21 chưa chạy. Không có `EXEC` không trỏ về TC.
- **Execution:** 21 EXEC (018…038), không trùng ID; mỗi EXEC trỏ đúng một TC.
- **Defect:** 11 BUG đều trỏ về US/AC/BR/TC; BUG không có TC tương ứng sẽ bị coi là orphan (không xảy ra).
- **ID:** FLW/US/AC/BR/SCR/API/TS/TC/EXEC/BUG đều tiếp số từ bộ `checkout-to-delivery` (US-010, AC-036, BR-043, SCR-013, API-052, TS-006, TC-050, EXEC-017, BUG-021, OQ-005).

## Ngoại lệ có chủ đích

- `API-011` (tracking) và `API-053…055` (notifications) không có TC riêng; chúng thuộc SCR-021/SCR-025 và được phủ bởi TC-072/TC-087 hoặc ghi nhận ở audit.
- `TC-088` (JWT refresh) không chạy trong lần này dù test tồn tại; giữ `Not Run`.
