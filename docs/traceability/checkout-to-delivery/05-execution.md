# Execution Records — FLW-001

Chỉ ghi nhận lần chạy thật. Mọi `PASS` dưới đây đến từ Jest unit test đã chạy ngày
**2026-11-18**; không có E2E/UI execution trong bộ này (xem `07-report.md`).

## Môi trường

| Trường | Giá trị |
|---|---|
| Ngày chạy | 2026-11-18 (Asia/Ho_Chi_Minh) |
| Máy | Windows 10.0.26200, x64 |
| Runtime | Node v22.22.0, Jest 29.7.0, ts-jest |
| Lệnh | `npx jest --config test/jest-unit.json --runInBand --verbose <patterns>` |
| Build | `FashionAI_BE` HEAD `1f6319c` + thay đổi chưa commit (`package.json`, `prisma/seed.ts`, `src/modules/payments/zalopay/zalopay.gateway.ts`) |
| Tester | Automated (CI-local) |
| Phạm vi | Unit test thuần, DB/Redis/GHN/cổng thanh toán được mock |
| Tổng | 18 suite, 103 test, 103 PASS, 0 FAIL |

Bằng chứng thô: `FashionAI_BE/.tmp/traceability-jest.log`,
`FashionAI_BE/.tmp/traceability-jest-2.log`.

---

### EXEC-001 — TC-001 (giá sale campaign)

- Date: 2026-11-18
- Environment: local unit (mocked Prisma)
- Build: HEAD `1f6319c` + working tree
- Tester: Automated
- Status: PASS
- Expected: Campaign sâu nhất theo đơn giá thắng; hoà chọn `endsAt`/`id`; chỉ trả sản phẩm đang sale.
- Actual: Khớp.
- Evidence: `test/unit/sale-pricing.service.spec.ts` — “làm tròn giá sale theo đơn giá”, “trả map rỗng và không query khi không có sản phẩm”, “chọn giá sale thấp nhất khi một sản phẩm trúng nhiều campaign”, “hoà giá sale thì chọn endsAt sớm hơn, rồi id nhỏ hơn”, “chỉ trả các sản phẩm đang sale và giữ đúng giá niêm yết từng sản phẩm”.
- Related defect: –

### EXEC-002 — TC-002 (fingerprint đơn)

- Date / Environment / Build / Tester: như trên
- Status: PASS
- Expected: `comboType` khác → fingerprint khác; payload cũ giữ nguyên fingerprint.
- Actual: Khớp.
- Evidence: `test/unit/order-fingerprint.spec.ts` — “payload không có comboType giữ nguyên fingerprint như trước khi thêm comboType”, “comboType khác nhau cho fingerprint khác nhau”.
- Related defect: –

### EXEC-003 — TC-006 (hết hạn đơn chưa thanh toán)

- Status: PASS
- Expected: Hủy đơn quá hạn, payment PENDING → EXPIRED, trả coupon đúng một lần, ghi lịch sử + báo khách, bỏ qua đơn vừa PAID.
- Actual: Khớp.
- Evidence: `test/unit/order-expiry.spec.ts` — “xoá lượt dùng và trả lại used_count đúng một lần”, “đơn không dùng mã thì không làm gì”, “hủy đơn quá hạn, hết hạn payment chờ, trả mã, ghi lịch sử và báo khách”, “đơn vừa được thanh toán giữa chừng thì bỏ qua, không trả mã”, “đơn nâng cấp gói hết hạn không gửi thông báo đơn hàng”.
- Related defect: BUG-004 (đơn hết hạn ghi `CANCELLED`, không dùng `EXPIRED`).

### EXEC-004 — TC-011 (sai số tiền / cổng báo thất bại)

- Status: PASS
- Expected: SUCCESS sai tiền → chặn + `REFUND_REQUIRED`; FAILED amount 0 → FAILED, không báo lệch tiền.
- Actual: Khớp.
- Evidence: `test/unit/payment-gateway-result.spec.ts` — “ZaloPay báo thất bại/hết hạn (amount = 0): đánh dấu FAILED, không báo lệch số tiền”, “ZaloPay báo đã thu nhưng sai số tiền: vẫn chặn và gắn cờ cần hoàn tiền”.
- Related defect: –

### EXEC-005 — TC-012 (khoá chống trùng giao dịch)

- Status: PASS
- Expected: Xác nhận tay hai đơn cùng ghi chú không đụng khoá; cổng khoá theo `transactionId`.
- Actual: Khớp.
- Evidence: `test/unit/payment-keys.spec.ts` — “xác nhận tay hai đơn cùng ghi chú không đụng khoá chống trùng”, “thanh toán qua cổng vẫn khoá theo mã giao dịch để một khoản tiền không ghi cho hai đơn”, “mã giao dịch xác nhận tay gắn mã đơn, cổng thanh toán giữ mã của cổng”.
- Related defect: –

### EXEC-006 — TC-017 (outbox jobId)

- Status: PASS
- Expected: `jobId` = id event, không chứa `:`.
- Actual: Khớp.
- Evidence: `test/unit/outbox-service.spec.ts` — “enqueueEvent đặt jobId theo id của event, không có dấu ':'”, “createEvent trong transaction cũng không đặt jobId có dấu ':'”.
- Related defect: –

### EXEC-007 — TC-018 (giá trị bảo hiểm GHN)

- Status: PASS
- Expected: `insurance_value = Σ price×qty`, không gồm ship/giảm giá; admin và outbox cùng giá trị.
- Actual: Khớp.
- Evidence: `test/unit/shipment-insurance.spec.ts` — “cộng đơn giá × số lượng, không phụ thuộc mã giảm giá hay phí ship”, “admin tạo vận đơn (OrdersService) khai cùng giá trị với lúc báo giá”, “outbox tạo vận đơn (ShipmentService) cũng khai theo tiền hàng”.
- Related defect: –

### EXEC-008 — TC-019 (hủy vận đơn sau khi lấy hàng)

- Status: PASS
- Expected: PICKED/SHIPPING/DELIVERING/RETURNING bị chặn, không gọi GHN; READY_TO_PICK/PICKING được hủy; `canCancel` chỉ trước khi lấy.
- Actual: Khớp.
- Evidence: `test/unit/shipment-cancel.spec.ts` — 9 test tương ứng (“admin hủy vận đơn PICKED…”, “SHIPPING…”, “DELIVERING…”, “RETURNING…”, “READY_TO_PICK…”, “PICKING…”, “nút hủy (canCancel) chỉ bật trước khi lấy hàng”, “API hủy vận đơn theo đơn (OrdersService) cũng chặn sau khi lấy hàng”).
- Related defect: BUG-012 (hủy vận đơn không đổi trạng thái đơn/không báo khách).

### EXEC-009 — TC-020 (GHN webhook secret)

- Status: PASS
- Expected: Nhận secret qua header/query; thiếu/sai → 401; chưa cấu hình → bỏ kiểm tra.
- Actual: Khớp.
- Evidence: `test/unit/ghn-webhook.spec.ts` — “nhận secret qua ?secret= trên URL”, “vẫn nhận secret qua header như trước”, “từ chối khi thiếu secret”, “từ chối khi sai secret trên URL”, “từ chối khi secret không phải chuỗi”, “chưa cấu hình GHN_WEBHOOK_SECRET thì không kiểm tra”.
- Related defect: BUG-014 (secret tuỳ chọn ⇒ webhook không xác thực nếu quên cấu hình).

### EXEC-010 — TC-021 (webhook lặp/cũ)

- Status: PASS
- Expected: Event lặp chỉ audit; event cũ không lùi trạng thái; thiếu timestamp không ghi đè; một vận đơn lỗi không chặn batch.
- Actual: Khớp.
- Evidence: `test/unit/ghn-webhook.spec.ts` — “callback lặp lại trạng thái hiện có (vd. update_fee) chỉ lưu audit, không thêm lịch sử đơn”, “trạng thái vận đơn giữ nguyên nhưng đơn còn kẹt phía sau thì vẫn kéo đơn lên và ghi lịch sử”; `test/unit/shipment-status-sync.spec.ts` — “trạng thái không đổi thì chỉ cập nhật lastSyncedAt…”, “không lùi trạng thái khi mốc GHN cũ hơn…”, “GHN không trả mốc thời gian thì không ghi đè…”, “một vận đơn lỗi không chặn các vận đơn còn lại”.
- Related defect: BUG-011 (`signatureValid`/`WebhookEvent.status` gây hiểu nhầm audit).

### EXEC-011 — TC-022 (ánh xạ trạng thái vận chuyển → đơn)

- Status: PASS
- Expected: Chỉ tiến trạng thái; DELIVERED đẩy READY_TO_SHIP/SHIPPING → DELIVERED; các trạng thái khác giữ nguyên; không ghi đè khi đơn đổi nơi khác.
- Actual: Khớp.
- Evidence: `test/unit/shipment-order-status.spec.ts` — 19 test (“READY_TO_SHIP + vận đơn PICKED → SHIPPING”, … “DELIVERED + vận đơn DELIVERING → giữ nguyên”, “GHN đã giao: đơn sang DELIVERED…”, “đơn vừa bị đổi trạng thái ở nơi khác (updateMany = 0) thì không ghi đè, không báo”).
- Related defect: –

### EXEC-012 — TC-027 (tiền hàng hoàn theo món)

- Status: PASS
- Expected: Chỉ món lỗi; trừ giảm giá theo tỷ lệ; đơn cũ fallback cột Decimal.
- Actual: Khớp.
- Evidence: `test/unit/issue-refund-amount.spec.ts` — “tiền hàng chỉ gồm món bị lỗi, không gộp phí ship”, “trừ phần mã giảm giá của món theo giá trị món”, “đơn cũ chưa có cột *Vnd lấy từ cột Decimal và tổng các dòng”.
- Related defect: –

### EXEC-013 — TC-028 (base phí ship hoàn)

- Status: PASS
- Expected: Lấy `shippingFeeVnd`, đơn cũ lấy `shippingFee`.
- Actual: Khớp.
- Evidence: `test/unit/issue-refund-amount.spec.ts` — “lấy phí ship ban đầu, đơn cũ lấy từ cột Decimal”.
- Related defect: BUG-010 (mặc định hoàn ship khi client bỏ trống `refundShipping`).

### EXEC-014 — TC-029 (chặn chốt tay khi cổng đang hoàn)

- Status: PASS
- Expected: Cổng đang hoàn → chặn; `PAYMENT_ONLY` không chặn; trừ tiền cổng đã hoàn vào hạn mức.
- Actual: Khớp.
- Evidence: `test/unit/order-refund-manual.spec.ts` — “cho phép chốt hoàn tiền khi cổng không có khoản hoàn nào đang chạy”, “chặn chốt tay khi cổng đang hoàn tiền cho cùng đơn”, “khoản hoàn PAYMENT_ONLY (thu trùng) không chặn chuyển khoản tay của đơn”, “trừ tiền cổng đã hoàn vào hạn mức còn lại của đơn”.
- Related defect: –

### EXEC-015 — TC-030 (chứng từ hoàn tiền trong email)

- Status: PASS
- Expected: Email có tiền/STK/mã GD/ảnh; bỏ URL không http(s); escape nội dung ngân hàng; không hiện STK với refund cổng.
- Actual: Khớp.
- Evidence: `test/unit/refund-completed.template.spec.ts` — 6 test (“hiển thị số tiền, tài khoản nhận…”, “nhúng ảnh chứng từ…”, “không render khối chứng từ…”, “bỏ qua URL chứng từ không phải http(s)”, “không hiện khối tài khoản ngân hàng…”, “escape nội dung ngân hàng…”); `test/unit/refund.util.spec.ts` — “lấy ảnh chứng từ đã lưu, bỏ trùng và chỉ nhận URL http(s)”, “cộng dồn ảnh chứng từ lúc duyệt và lúc chốt hoàn tiền”.
- Related defect: –

### EXEC-016 — TC-031 (rollup `paymentStatus`)

- Status: PASS
- Expected: PAID → PARTIALLY_REFUNDED → REFUNDED theo tổng đã hoàn.
- Actual: Khớp.
- Evidence: `test/unit/refund.util.spec.ts` — “giữ PAID khi chưa hoàn đồng nào”, “trả PARTIALLY_REFUNDED khi hoàn một phần”, “trả REFUNDED khi hoàn đủ hoặc vượt số đã thu”.
- Related defect: –

### EXEC-017 — TC-041 (transition sau khi giao)

- Status: PASS
- Expected: SHIPPING/DELIVERED/COMPLETED cho phép tạo yêu cầu trả; RETURN_APPROVED → RETURNING/RETURNED.
- Actual: Khớp.
- Evidence: `test/unit/order-flow.constants.spec.ts` — “cho phép duyệt trả hàng từ các trạng thái sau khi giao”, “RETURN_APPROVED đi tiếp được sang RETURNING và RETURNED”.
- Related defect: BUG-005 (map bị bỏ qua ở 4 luồng ghi trực tiếp).

---

## Test case không có execution record

`TC-003, TC-004, TC-005, TC-007, TC-008, TC-009, TC-010, TC-013, TC-014, TC-015,
TC-016, TC-023, TC-024, TC-025, TC-026, TC-032, TC-033, TC-034, TC-035, TC-036,
TC-037, TC-038, TC-039, TC-040, TC-042, TC-043` — trạng thái `Not Run`. Không có
PASS/FAIL cho các test case này; lý do: cần DB/Redis/cổng sandbox hoặc trình duyệt,
không có trong lần chạy này.
