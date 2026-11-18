# Ma trận truy vết — FLW-003 (live try-on)

`—` = chưa có execution. Mỗi dòng là một BR.

| US | AC | BR | SCR/FLW | TC | EXEC | BUG |
|---|---|---|---|---|---|---|
| US-019, US-024 | AC-061, AC-067, AC-078 | BR-082 | SCR-026, SCR-027 | TC-093, TC-123 | EXEC-039, EXEC-040 | — |
| US-023 | AC-061, AC-067 | BR-083 | SCR-026 | TC-093, TC-119 | EXEC-039, EXEC-054 | — |
| US-019, US-020 | AC-064 | BR-084 | SCR-026 | TC-100 | — | — |
| US-019, US-020 | AC-064 | BR-085 | SCR-026 | TC-101, TC-127, TC-129 | EXEC-059, EXEC-061 | BUG-039 |
| US-020 | AC-064 | BR-086 | SCR-026 | TC-098, TC-099 | EXEC-041, EXEC-042 | — |
| US-020 | AC-065 | BR-087 | SCR-026 | TC-100, TC-128 | EXEC-060 | — |
| US-020 | AC-066 | BR-088 | SCR-026 | TC-102, TC-103, TC-104, TC-127 | EXEC-043, EXEC-044, EXEC-045, EXEC-059 | — |
| US-020 | AC-066 | BR-089 | SCR-026 | TC-105, TC-106 | EXEC-046, EXEC-047 | — |
| US-021 | AC-082 | BR-090 | SCR-026 | TC-120, TC-130 | EXEC-055 | BUG-033 |
| US-019 | AC-069 | BR-091 | SCR-026 | TC-109 | — | — |
| US-019 | AC-069 | BR-092 | SCR-026 | TC-108, TC-110 | EXEC-049 | — |
| US-025 | AC-072, AC-083 | BR-093 | SCR-026 | TC-107, TC-110 | EXEC-048 | — |
| US-023 | AC-063 | BR-094 | SCR-026 | TC-096 | — | — |
| US-019, US-022 | AC-068, AC-076 | BR-095 | SCR-026 | TC-107 | EXEC-048 | — |
| US-025 | AC-070 | BR-096 | SCR-026 | TC-111 | EXEC-050 | BUG-035 |
| US-019 | AC-061, AC-068 | BR-097 | SCR-026 | TC-097 | — | — |
| US-019 | AC-068 | BR-098 | SCR-026 | TC-107 | EXEC-048 | — |
| US-022 | AC-076 | BR-099 | SCR-026 | TC-107 | EXEC-048 | — |
| US-024 | AC-078 | BR-100 | SCR-027 | TC-107 | EXEC-048 | — |
| US-025 | AC-083 | BR-101 | SCR-026 | TC-107 | EXEC-048 | — |
| US-025 | AC-083 | BR-102 | SCR-026 | TC-112 | EXEC-051 | — |
| US-025 | AC-071 | BR-103 | SCR-026 | TC-112 | EXEC-051 | — |
| US-021 | AC-073 | BR-104 | SCR-026 | TC-115, TC-122 | EXEC-057 | BUG-040 |
| US-021, US-025 | AC-070, AC-073 | BR-105 | SCR-026 | TC-115, TC-118 | — | BUG-035 |
| US-021 | AC-074 | BR-106 | SCR-026 | TC-113, TC-114, TC-117 | EXEC-052, EXEC-053 | — |
| US-021 | AC-075 | BR-107 | SCR-026 | TC-113 | EXEC-052 | — |
| US-021 | AC-082 | BR-108 | SCR-026 | TC-113, TC-130 | EXEC-052 | BUG-033, BUG-036 |
| US-022 | AC-076 | BR-109 | SCR-026 | TC-116 | — | — |
| US-026 | AC-077 | BR-110 | SCR-026 | TC-126 | EXEC-058 | — |
| US-022, US-026 | AC-077 | BR-111 | SCR-026 | TC-118, TC-126 | EXEC-058 | BUG-034 |
| US-019…US-022, US-025 | AC-068, AC-073, AC-074, AC-076 | BR-112 | SCR-026 | TC-114, TC-117 | EXEC-053 | — |
| US-024 | AC-078, AC-084 | BR-113 | SCR-027 | TC-123 | — | BUG-037 |
| US-024 | AC-078 | BR-114 | SCR-027 | TC-123 | — | — |
| US-024 | AC-078 | BR-115 | SCR-027 | TC-124 | — | BUG-037 |
| US-019 | AC-064 | BR-116 | SCR-026 | TC-125 | — | BUG-038 |
| US-024 | AC-078 | BR-117 | SCR-027 | TC-107, TC-123 | EXEC-048 | — |

## Kiểm tra

- **Forward:** 8 US → 24 AC → 36 BR → 2 SCR → 38 TC. Mọi BR có ≥1 TC; mọi AC có ≥1 BR.
- **Backward:** 23 EXEC ánh xạ đúng TC đã chạy; 15 TC `Not Run`; không có EXEC mồ côi.
- **Defect:** 9 BUG đều trỏ về BR/TC; BUG-041 (dead code) gắn TC-127…TC-129.
- **ID:** tiếp số sau FLW-002 (US-018, AC-060, BR-081, SCR-025, CMP-052, API-055, TS-012, TC-092, EXEC-038, BUG-032, OQ-011).

## Ngoại lệ

- `API-060` (session status) không có TC riêng; được phủ gián tiếp bởi TC-113/TC-117 và ghi ở OQ-014.
- Không có màn lịch sử live; `SCR-026` là surface duy nhất cho customer.
