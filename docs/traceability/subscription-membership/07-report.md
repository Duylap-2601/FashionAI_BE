# TR-003 — Test report & metrics — FLW-005 (subscription)

Tính từ `04-test-cases.md` (44 TC) và `05-execution.md` (44 EXEC), ngày 2026-11-18. Không dùng số test Jest làm mẫu số.

## 1. Chỉ số thực thi

| Chỉ số | Giá trị | Mẫu số |
|---|---:|---|
| Test case thiết kế | 44 | TC-178…TC-221 |
| Đã chạy (có EXEC) | 44 | 44 TC |
| PASS | 43 | 43 đã chạy |
| FAIL | 0 | 43 đã chạy |
| BLOCKED | 1 | TC-220 (cần browser/timer thật) |
| Not Run | 0 | 44 TC |
| Pass Rate | **100,0%** | 43 / (43 + 0) |
| Execution Rate | **100,0%** | (43 + 0 + 1) / 44 |
| Design coverage | 38/38 BR; 24/24 AC | BR-156…BR-193 / AC-109…AC-132 |
| Execution coverage | 44/44 TC | toàn bộ TC |

`Pass Rate 100%` chỉ nghĩa là mọi test **đã chạy được** đều khớp kỳ vọng. 1 TC `BLOCKED` **không** được tính là coverage thực thi.

## 2. Theo nhóm

| Nhóm (TS) | TC | PASS | BLOCKED |
|---|---:|---:|---:|
| TS-029 — Giá, gói, checkout | 7 | 7 | 0 |
| TS-030 — Proration & chuyển gói | 3 | 3 | 0 |
| TS-031 — Xác nhận thanh toán & cấp quyền | 13 | 13 | 0 |
| TS-032 — Hẹn hạ gói & quản lý nhắc | 5 | 5 | 0 |
| TS-033 — Hoàn tiền thu hồi quyền lợi | 11 | 11 | 0 |
| TS-034 — Nhắc gia hạn & sau thanh toán | 5 | 4 | 1 (TC-220) |

## 3. Defect

| Severity | Số | Đã đóng |
|---|---:|---:|
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 3 | 0 |
| Low | 3 | 0 |
| **Tổng** | **6** | **0** |

- **BUG-058 (Medium):** chặn SCHEDULED chỉ ở checkout, webhook không kiểm tra lại → nguy cơ hai lịch hẹn/race.
- **BUG-060 (Medium):** giá fallback FE độc lập với BE → hiển thị giá cũ khi plans lỗi.
- **BUG-062 (Medium):** thiếu test cho return page poll/invalidate (khoảng trống bằng chứng, không phải hành vi sai).
- 3 Low: page không clamp trong service; modal 409 không có `details` cấu trúc; `autoRenew` bị hiểu là autopay.

## 4. Bằng chứng & giới hạn

- BE unit **33** test PASS (`subscription-lifecycle` 11, `subscription-proration` 4, `subscription-refund-revocation` 12, `renewal-reminder-lock` 3, `subscription-history` 3).
- BE e2e **60** test PASS (`payments-checkout` 21, `payments-webhook` 26, `subscription-endpoints` 11, `payments-unmatched` 2).
- FE **5** test PASS (`payment-display`).
- Không chạy ZaloPay/SePay/Postgres/Redis/browser thật; chữ ký webhook dùng secret test; partial unique index và lock Redis chỉ mô phỏng.

## 5. Khuyến nghị phát hành

**Ready with Known Issues** cho phạm vi gói thành viên, với điều kiện:

1. Chạy smoke test **ZaloPay/SePay sandbox** + 1 kiểm tra Postgres thật cho partial unique index `one_active_subscription_per_user`.
2. Chạy 1 browser test cho return page (TC-220) trước khi đổi mặc định thanh toán.
3. Chấp nhận có văn bản 3 Medium (BUG-058/060/062) hoặc đóng BUG-058 trước khi mở bán gói quy mô lớn.

Không có Critical/High: luồng cấp quyền, gia hạn, nâng cấp, hạ gói, hoàn tiền và nhắc gia hạn đều đã có test PASS trên mock.
