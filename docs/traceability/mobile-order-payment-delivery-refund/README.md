# Traceability — Mobile: Đặt hàng → Thanh toán → Giao hàng → Đổi trả/Hoàn tiền

Bộ tài liệu cho `FashionAI_Mobile` (Expo/React Native), workflow **FLW-002**. Đặt trong BE theo quy ước `docs/traceability/`; bộ BE/web tương ứng là `../checkout-to-delivery/` (**FLW-001**).

## Đọc theo thứ tự

| File | Nội dung |
|---|---|
| `00-workflow.md` | Phạm vi, actor, sơ đồ luồng, 17 bước, alternate paths, OQ |
| `01-user-stories.md` | 8 US (US-011…US-018) + 24 AC (AC-037…AC-060) |
| `02-business-rules.md` | 38 BR mobile (BR-044…BR-081) + enforcement point |
| `03-screens-and-flows.md` | 9 SCR (SCR-017…SCR-025), 12 CMP, API map |
| `04-test-cases.md` | 6 TS, 42 TC (TC-051…TC-092) |
| `05-execution.md` | 21 EXEC thật từ Jest 2026-11-18 |
| `06-defects.md` | 11 defect candidate (4 High, 2 Medium, 5 Low) |
| `07-report.md` | Pass 100% (21/21), execution 50,0% (21/42) |
| `08-traceability-matrix.md` | Ma trận 38 dòng + kiểm tra hai chiều |
| `09-audit.md` | 5 finding High, 6 OQ, remediation |

## Số liệu cốt lõi

- **Thiết kế:** 8 US / 24 AC / 38 BR / 9 SCR / 42 TC.
- **Thực thi:** 21 PASS / 0 FAIL / 0 BLOCKED / 21 Not Run.
- **Độ phủ:** AC 24/24, BR 38/38 có ít nhất một TC.
- **Mức phát hành:** toàn workflow `Insufficient Evidence`; luồng thanh toán đơn `Not Ready` (BUG-022, BUG-023).

## Bằng chứng đã chạy

```bash
cd D:/EXE/FashionAI_Mobile
npx jest --runInBand --verbose src/features/cart src/features/checkout \
  src/features/orders src/features/payments src/features/shipping \
  src/features/notifications/utils/order-notification-target.test.ts src/api/http.test.ts
# 13 suites / 109 tests passed — log D:/EXE/.tmp/mobile-flow-jest.log
```

Không chạy app thật, camera, cổng thanh toán, GHN hay push. `PASS` chỉ áp dụng cho lớp unit/contract; xem giới hạn ở `05-execution.md` và `07-report.md`.

## Quan hệ với bộ BE/web

- API ID dùng lại `API-001…API-052` của FLW-001; bộ này thêm `API-053…055` cho notifications.
- Luật server (giá, quote token, state machine, 7 ngày, hoàn tiền) thuộc FLW-001; bộ này chỉ ghi hành vi mobile và các điểm lệch.
- ID toàn project không trùng: US-011+, AC-037+, BR-044+, SCR-014+ (FLW-002 dùng SCR-017+), TC-051+, EXEC-018+, BUG-022+, OQ-006+.

## Giới hạn

- Không phải E2E; 21 TC `Not Run` chủ yếu là UI/WebView/deep link/nhánh lỗi.
- Defect là **candidate** từ đọc code, chưa repro trên thiết bị.
- Bộ tài liệu không sửa source app/BE.
