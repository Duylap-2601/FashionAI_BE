# Traceability matrix — FLW-005 (subscription)

Ma trận hai chiều: US → AC → BR → SCR/API → TC → EXEC → BUG.

`-` = không có liên kết tương ứng.

| US | AC | BR | SCR/FLW | TC | EXEC | BUG |
|---|---|---|---|---|---|---|
| US-035 | AC-109 | BR-156 | SCR-030 / API-072 | TC-178 | EXEC-116 | - |
| US-035 | AC-109 | BR-157 | SCR-030 / API-072 | TC-178 | EXEC-116 | - |
| US-035 | AC-110, AC-119 | BR-158 | SCR-030 / API-073 | TC-182, TC-185, TC-186, TC-187 | EXEC-120, EXEC-123, EXEC-124, EXEC-125 | - |
| US-035 | AC-111 | BR-159 | API-073 | TC-180 | EXEC-118 | - |
| US-035 | AC-112 | BR-160 | SCR-030 / API-073 | TC-181 | EXEC-119 | - |
| US-035 | AC-110 | BR-161 | API-073 | TC-182 | EXEC-120 | - |
| US-035 | AC-112 | BR-162 | API-073 | TC-181 | EXEC-119 | - |
| US-038 | AC-113, AC-123 | BR-163 | SCR-030 / CMP-076 | TC-183 | EXEC-121 | BUG-061 |
| US-035 | AC-110 | BR-164 | API-073 | TC-182 | EXEC-120 | - |
| US-035, US-037 | AC-110, AC-119 | BR-165 | SCR-031 | TC-182 | EXEC-120 | - |
| US-035 | AC-115 | BR-166 | API-080 | TC-195, TC-196, TC-198, TC-200 | EXEC-133, EXEC-134, EXEC-136, EXEC-138 | - |
| US-035 | AC-116 | BR-167 | API-080 | TC-199 | EXEC-137 | - |
| US-035 | AC-115 | BR-168 | API-080 | TC-189, TC-194 | EXEC-127, EXEC-132 | - |
| US-036 | AC-117, AC-118 | BR-169 | API-080 | TC-193, TC-184 | EXEC-131, EXEC-122 | - |
| US-037 | AC-121 | BR-170 | API-080 | TC-189 | EXEC-127 | - |
| US-037 | AC-121 | BR-171 | API-080 | TC-190, TC-191, TC-192 | EXEC-128, EXEC-129, EXEC-130 | - |
| US-038 | AC-122 | BR-172 | API-080 | TC-221 | EXEC-159 | BUG-058 |
| US-035, US-036 | AC-117 | BR-173 | DB index | TC-193, TC-194 | EXEC-131, EXEC-132 | BUG-058 |
| US-038 | AC-123 | BR-174 | API-080 | TC-221 | EXEC-159 | BUG-058 |
| US-035 | AC-115 | BR-175 | API-080 | TC-188, TC-189, TC-200 | EXEC-126, EXEC-127, EXEC-138 | - |
| US-035 | AC-116 | BR-176 | API-080 | TC-199 | EXEC-137 | - |
| US-035, US-038 | AC-115, AC-122 | BR-177 | CMP-073 | TC-197, TC-221 | EXEC-135, EXEC-159 | - |
| US-042 | AC-132 | BR-178 | Job nhắc gia hạn | TC-217, TC-219 | EXEC-155, EXEC-157 | - |
| US-039 | AC-124, AC-125 | BR-179 | SCR-030 / CMP-073 | TC-204, TC-205 | EXEC-142, EXEC-143 | BUG-063 |
| US-041 | AC-129 | BR-180 | API refund | TC-206, TC-208, TC-211, TC-212, TC-214, TC-215 | EXEC-144, EXEC-146, EXEC-149, EXEC-150, EXEC-152, EXEC-153 | - |
| US-041 | AC-130 | BR-181 | API refund | TC-207, TC-213 | EXEC-145, EXEC-151 | - |
| US-041 | AC-131 | BR-182 | API refund | TC-209 | EXEC-147 | - |
| US-041 | AC-131 | BR-183 | API refund | TC-210 | EXEC-148 | - |
| US-041 | AC-131 | BR-184 | API refund | TC-214, TC-216 | EXEC-152, EXEC-154 | - |
| US-040 | AC-127 | BR-185 | SCR-030 / API-074 | TC-179, TC-202 | EXEC-117, EXEC-140 | - |
| US-040 | AC-128 | BR-186 | SCR-030 / API-075 | TC-203 | EXEC-141 | BUG-059 |
| US-039 | AC-124 | BR-187 | API-076 | TC-204 | EXEC-142 | - |
| US-039 | AC-125 | BR-188 | API-077 | TC-205 | EXEC-143 | - |
| US-039 | AC-126 | BR-189 | API-078 | TC-201 | EXEC-139 | - |
| US-035 | AC-109 | BR-190 | SCR-030 / CMP-072 | TC-178 | EXEC-116 | BUG-060 |
| US-035, US-037 | AC-110, AC-119 | BR-191 | SCR-030 / CMP-071 | TC-182, TC-185 | EXEC-120, EXEC-123 | - |
| US-037 | AC-119 | BR-192 | SCR-030 / CMP-075 | TC-185 | EXEC-123 | - |
| US-042 | AC-132 | BR-193 | SCR-031 / CMP-078, CMP-079 | TC-220 | EXEC-158 (BLOCKED) | BUG-062 |

## Kiểm tra hai chiều

| Hướng | Kết quả |
|---|---|
| Forward US→AC→BR→SCR→TC | 8 US, 24 AC, 38 BR, 2 SCR đều có ít nhất 1 TC; không có BR mồ côi |
| Forward TC→EXEC | 44/44 TC có EXEC (1 BLOCKED); không có TC thiếu EXEC |
| Backward TC→BR | 44/44 TC có link BR; không có test mồ côi |
| Backward BUG→TC/BR | 6/6 defect có BR + TC (BUG-062 gắn TC-220) |
| Consistency | Không trùng ID; BR-156…BR-193, TC-178…TC-221, BUG-058…BUG-063, EXEC-116…EXEC-159 |
| Intent | Điểm lệch code↔học thuyết được ghi thành BUG-058…063, không sửa requirement theo code |

## Ngoại lệ có chủ đích

- `API-080` gộp ba webhook (`sepay-ipn`, `sepay-webhook`, `zalopay/callback`); `API-081` (`/users/me/quota`) thuộc FLW-004 nhưng là phụ thuộc sau khi đổi tier nên chỉ link chứ không đặt TC ở đây.
- Không có màn admin riêng: admin thao tác qua refund flow chung (`checkout-to-delivery`), nên US-041 không có SCR riêng.
- TC-220 (`return page poll`) là hành vi FE/timer, không phải luật nghiệp vụ; vẫn giữ để chứng minh BR-193.
- BUG-059 và BUG-062 là defect về **bằng chứng/phòng thủ**, không phải hành vi sai đã tái hiện — ghi rõ trong `06-defects.md`.
