# Audit — FLW-003 (live try-on)

## 1. Findings

| Severity | Check | Finding | Evidence | Required action |
|---|---|---|---|---|
| High | Forward | 15/38 TC chưa chạy; toàn bộ pause/end accounting, admin, ownership, allowlist ở mức `Not Run` | `05-execution.md` | Chạy staging + provider thật trước khi coi là verified |
| High | Forward | Không có test WebRTC/camera/first-frame; 23 EXEC chỉ là unit/render | `07-report.md` | Bổ sung browser E2E tối thiểu cho start/pause/resume/end |
| Medium | Intent | Pause giữ lease/slot, trái plan “giải phóng slot xử lý” | `pauseSession`; BUG-035 | Quyết định semantics slot rồi sửa code hoặc docs |
| Medium | Intent | Worker không chuyển PAUSED quá hạn sang EXPIRED | BUG-034 | Set terminal state + test |
| Medium | Intent | Đổi món khi resume được code/test hỗ trợ nhưng docs cấm | BUG-036 | Chốt sản phẩm: cập nhật docs hoặc bỏ nhánh |
| Medium | Consistency | Admin version không optimistic lock | BUG-037 | So khớp version trước khi ghi |
| Medium | Intent | Beta allowlist được tài liệu nhưng không code | BUG-038 | Implement hoặc xoá khỏi docs |
| Low | Consistency | Pause ghi reason vào `endedReason` | BUG-040 | Tách trường/ghi audit |
| Low | Consistency | Combo chỉ validate ảnh primary | BUG-039 | Ghi rõ hoặc validate mọi ảnh |
| Low | Backward | `prepareLiveOutfitReference` + 3 test không có caller | BUG-041 | Xoá dead code/test hoặc nối vào UI |
| Low | Consistency | Plan mô tả `blockedUntil` thiếu pauseTimeout | BR-095 | Cập nhật plan |
| Low | Consistency | Trạng thái DB PAUSING/RESUMING/ENDING không dùng | `schema.prisma:79-88` | Xoá hoặc dùng |

## 2. Kết luận

- Không có broken reference/ID trùng; 23 EXEC khớp 23 TC.
- 36/36 BR có TC; 24/24 AC có BR.
- **Accepted:** các finding không được sửa vì bộ tài liệu read-only trên source. Release vẫn chặn theo `07-report.md`.

## 3. Open questions

### OQ-012 — Paused session có chiếm slot provider?
- **Question:** `maxConcurrentSessions` đếm phiên PAUSED hay chỉ phiên đang xử lý?
- **Why:** BUG-035; ảnh hưởng chi phí và công bằng giữa user.
- **Owner:** Product + BE.

### OQ-013 — Đổi món trong phiên: cho phép hay cấm?
- **Question:** Giữ hành vi resume-with-productId hay quay lại “End rồi tạo phiên mới”?
- **Why:** BUG-036; docs và code mâu thuẫn.
- **Owner:** Product.

### OQ-014 — Đồng bộ nhiều tab
- **Question:** Tab thứ hai học trạng thái pause/end bằng cách nào khi không poll `GET /sessions/:id`?
- **Why:** Plan §7 nói nhiều tab phải cập nhật; code không có cơ chế.
- **Owner:** FE.

### OQ-015 — Beta allowlist
- **Question:** Có cần allowlist sản phẩm/user cho beta không, hay feature flag + tier là đủ?
- **Why:** BUG-038.
- **Owner:** Product + BE.

### OQ-016 — Direct transport và catalog-only
- **Question:** Chấp nhận rủi ro client sửa prompt/catalog hay cần signaling proxy?
- **Why:** Plan §11 đã nêu; chưa có quyết định.
- **Owner:** Security + BE.

### OQ-017 — Trạng thái terminal của phiên PAUSED hết hạn
- **Question:** EXPIRED hay một trạng thái `PAUSE_EXPIRED` riêng?
- **Why:** BUG-034; UI/FE cần biết có được resume không.
- **Owner:** BE + FE.

## 4. Remediation trong bộ tài liệu

- Tách 36 rule theo 4 nhóm; nối mỗi rule với code/test.
- Ghi 6 Medium + 3 Low là defect candidate, không hợp thức hoá hành vi lệch.
- Đánh dấu 15 TC `Not Run`; không dùng 23 test pass làm tỷ lệ coverage.
