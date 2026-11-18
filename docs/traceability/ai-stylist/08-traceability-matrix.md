# Ma trận truy vết — FLW-004 (AI Stylist)

`-` = không có execution tương ứng (TC `Not Run`).

| US | AC | BR | SCR/FLW | TC | EXEC | BUG |
|---|---|---|---|---|---|---|
| US-027 | AC-085 | BR-118 | SCR-028, FLW-004 | TC-175 | - | - |
| US-027 | AC-085 | BR-119 | SCR-028 | TC-131, TC-132 | EXEC-062 | - |
| US-027 | AC-085, AC-086 | BR-120 | SCR-028 | TC-131, TC-133, TC-149 | EXEC-063, EXEC-077 | BUG-042 |
| US-027, US-032 | AC-088, AC-099 | BR-121 | SCR-028 | TC-150 | EXEC-078 | - |
| US-027 | AC-087 | BR-122 | SCR-028 | TC-134 | EXEC-064 | - |
| US-027, US-034 | AC-105 | BR-123 | SCR-028 | TC-135, TC-165 | EXEC-065, EXEC-087 | - |
| US-028 | AC-089 | BR-124 | SCR-028 | TC-136, TC-137 | EXEC-066, EXEC-067 | - |
| US-028 | AC-089 | BR-125 | SCR-028 | TC-137 | EXEC-067 | - |
| US-028 | AC-091 | BR-126 | SCR-028 | TC-138, TC-139 | EXEC-068 | BUG-047 |
| US-028 | AC-090 | BR-127 | SCR-028 | TC-140 | EXEC-069 | BUG-052, BUG-053 |
| US-029 | AC-092 | BR-128 | SCR-028 | TC-141, TC-142 | EXEC-070 | BUG-050, BUG-057 |
| US-031, US-032 | AC-095, AC-099 | BR-129 | SCR-028 | TC-143, TC-152 | EXEC-071, EXEC-079 | - |
| US-030 | AC-094 | BR-130 | SCR-028 | TC-144 | EXEC-072 | - |
| US-029 | AC-093 | BR-131 | SCR-028 | TC-145 | EXEC-073 | BUG-057 |
| US-031 | AC-095 | BR-132 | SCR-028 | TC-146 | EXEC-074 | - |
| US-031 | AC-096 | BR-133 | SCR-028 | TC-147, TC-176 | EXEC-075 | BUG-056 |
| US-031 | AC-097 | BR-134 | SCR-028 | TC-148 | EXEC-076 | - |
| US-031 | AC-095 | BR-135 | SCR-028 | TC-154 | EXEC-081 | - |
| US-031 | AC-095, AC-097 | BR-136 | SCR-028 | TC-155, TC-156, TC-157, TC-173 | EXEC-082…EXEC-084, EXEC-092 | - |
| US-031 | AC-095 | BR-137 | SCR-028 | TC-159 | - | - |
| US-027 | AC-086 | BR-138 | SCR-028 | TC-158, TC-160 | EXEC-085 | - |
| US-032 | AC-098 | BR-139 | SCR-028 | TC-149 | EXEC-077 | BUG-043, BUG-044 |
| US-032 | AC-099 | BR-140 | SCR-028 | TC-152, TC-177 | EXEC-079 | BUG-055 |
| US-032 | AC-099 | BR-141 | SCR-028 | TC-151 | - | BUG-044 |
| US-032, US-033 | AC-099, AC-103 | BR-142 | SCR-028, SCR-029 | TC-150, TC-163 | EXEC-078 | BUG-043 |
| US-033 | AC-101 | BR-143 | SCR-028, SCR-029 | TC-161 | - | BUG-051 |
| US-033 | AC-101 | BR-144 | SCR-028, SCR-029 | TC-161 | - | - |
| US-033 | AC-102 | BR-145 | SCR-028, SCR-029 | TC-162, TC-172 | EXEC-086, EXEC-091 | - |
| US-033 | AC-103, AC-104 | BR-146 | SCR-029 | TC-163 | - | BUG-043 |
| US-033 | AC-104 | BR-147 | SCR-029 | TC-164 | - | - |
| US-027 | AC-087 | BR-148 | SCR-028 | TC-149 | EXEC-077 | BUG-052 |
| US-034 | AC-105, AC-106 | BR-149 | SCR-028 | TC-165, TC-166 | EXEC-087, EXEC-088 | - |
| US-034 | AC-106 | BR-150 | SCR-028 | TC-167 | EXEC-089 | - |
| US-034 | AC-107 | BR-151 | SCR-028 | TC-168 | - | - |
| US-034 | AC-107 | BR-152 | SCR-028 | TC-169 | - | BUG-045, BUG-054 |
| US-034 | AC-108 | BR-153 | SCR-028 | TC-170 | - | - |
| US-033, US-034 | AC-108 | BR-154 | SCR-028, SCR-029 | TC-161, TC-170 | - | BUG-048, BUG-054 |
| US-031, US-034 | AC-097, AC-108 | BR-155 | SCR-028 | TC-171 | EXEC-090 | BUG-049 |

## Kiểm tra hai chiều

| Hướng | Kết quả |
|---|---|
| Forward US→AC→BR→SCR→TC | 8 US, 24 AC, 38 BR, 2 SCR đều có ít nhất 1 TC; không có BR mồ côi |
| Forward TC→EXEC | 32/47 TC có EXEC; 15 TC `Not Run` (liệt kê trong `07-report.md`) |
| Backward TC→BR | 47/47 TC có link BR; không có test mồ côi |
| Backward BUG→TC/BR | 16/16 defect có BR + TC |
| Consistency | ID không trùng; BR-118/119/… tuần tự; không tái sử dụng ID của workflow khác |
| Intent | Các điểm lệch code↔hành vi mong đợi được ghi thành BUG-042…BUG-057, không sửa học thuyết theo code |

## Ngoại lệ có chủ đích

- `API-071` (catalog) không có BR riêng vì là API dùng chung; hành vi ACTIVE/gender được BR-129/130 quy định ở tầng stylist.
- Không có màn/admin action nào cho stylist; thay đổi model/prompt là thay đổi deploy/env, ngoài workflow.
- TC-168 (timeout) là kiểm tra cấu hình, không phải hành vi người dùng; vẫn giữ để chứng minh BR-151.
