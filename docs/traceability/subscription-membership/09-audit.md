# Audit — FLW-005 (subscription)

## 1. Findings

| Severity | Check | Finding | Evidence | Required action |
|---|---|---|---|---|
| Medium | Consistency | Chặn SCHEDULED chỉ ở checkout; webhook đổi gói không kiểm tra lại | BUG-058; `payments.service.ts:createSubscriptionOrder:202-210`; `subscription.service.ts:432-438` | Kiểm tra trong transaction cấp quyền cho mọi mode |
| Medium | Intent | Giá fallback FE độc lập với hằng số BE | BUG-060; `subscription-plans.tsx:74-105` | Ẩn giá hoặc chặn mua khi plans lỗi |
| Medium | Forward | Không có test cho return page poll 20 s / invalidate cache | BUG-062; EXEC-158 BLOCKED | Tách logic poll thành hàm thuần + test `node:test` |
| Low | Consistency | `getSubscriptionHistory` không clamp `page` (DTO đã chặn qua HTTP) | BUG-059; `subscription.service.ts:163-165` | Clamp trong service |
| Low | Consistency | 409 trả message văn xuôi, không có `details {tier, startsAt}` | BUG-061; `createSubscriptionOrder:206-210` | Trả `details` cấu trúc |
| Low | Intent | `autoRenew` dễ bị hiểu là autopay | BUG-063; `payments.controller.ts:310-323` | Đổi copy/DTO sang "nhắc gia hạn" |
| High | Backward | BR-186 ghi "page không validate" — **sai** so với code (DTO có `@Min(1)`) | `subscription-history-query.dto.ts:5-16`; EXEC-141 | Sửa câu chữ BR-186 (đã ghi đính chính) |

## 2. Kiểm tra hai chiều

| Hướng | Kết quả |
|---|---|
| US→AC | 8/8 US có AC testable; 24 AC |
| AC→BR | 24/24 AC ánh xạ ít nhất một BR |
| BR→TC | 38/38 BR có TC; không có BR mồ côi |
| TC→BR | 44/44 TC có link; không có test mồ côi |
| TC→EXEC | 44/44 có EXEC; 1 BLOCKED (TC-220) được liệt kê, không tính PASS |
| BUG→BR/TC | 6/6 defect candidate có link |
| ID | Không trùng; BR-156…BR-193, TC-178…TC-221, BUG-058…BUG-063, EXEC-116…EXEC-159 |

## 3. Điểm lệch có chủ đích (không tự sửa requirement theo code)

- BR-186 vẫn giữ yêu cầu "page hợp lệ" nhưng **đã sửa câu "page không validate"** vì code đã validate ở DTO; phần thiếu clamp trong service ghi thành BUG-059 mức Low.
- BR-173 (một ACTIVE/user) giữ nguyên; phần chặn SCHEDULED lệch giữa checkout và webhook ghi thành BUG-058 thay vì nới lỏng rule.
- BR-179 (`autoRenew` chỉ là nhắc) giữ nguyên; UI dùng từ dễ hiểu nhầm ghi thành BUG-063.
- Không có tài liệu yêu cầu gốc; toàn bộ US được suy từ UI/API và đánh dấu `Code-verified`.

## 4. Open questions

| ID | Câu hỏi | Ảnh hưởng | Đề xuất |
|---|---|---|---|
| OQ-024 | Có cho phép mua gói mới khi đang có SCHEDULED (thay thế lịch cũ) thay vì 409? | UX, tránh huỷ-rồi-mua | 409 hiện tại an toàn; nếu đổi, phải kiểm tra lại ở webhook |
| OQ-025 | Giá/quota có phải cam kết công khai không, hay chỉ là cấu hình? | Truyền thông, test | Coi là cấu hình; giá hiển thị phải đến từ server |
| OQ-026 | Fallback giá ở FE có được phép hiển thị khi API lỗi? | Rủi ro thu sai giá | Không hiển thị giá/không cho mua khi thiếu dữ liệu thật |
| OQ-027 | TTL link thanh toán 24h có khớp TTL thực của từng cổng? | Đơn treo, hoàn tiền | Xác nhận theo tài liệu ZaloPay/SePay trên staging |
| OQ-028 | Cho quote proration sống đúng 24h hay theo TTL link? | Số ngày cấp khi quote cũ | Hiện gộp 24h; tách nếu cổng có TTL khác |
| OQ-029 | Có cần charge định kỳ thật (autopay) không? | Kiến trúc, pháp lý | Hiện **không**; giữ mô hình nhắc + checkout thủ công |

## 5. Kết luận audit

- Không có Critical/High **hành vi**; có 1 High về **tài liệu** (BR-186 sai mô tả) đã đính chính.
- Không thể tuyên bố coverage đầy đủ: 43 test PASS đều mock provider/DB; 1 TC BLOCKED cần browser thật.
- Giữ toàn bộ ID; không sửa code ứng dụng trong quá trình audit (chỉ thêm test + tài liệu).
- Release: **Ready with Known Issues** cho phạm vi gói thành viên (xem `07-report.md`).
